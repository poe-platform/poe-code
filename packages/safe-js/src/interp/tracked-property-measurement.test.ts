import { afterEach, expect, it, vi } from "vitest";
import { accessorAdapter } from "./accessors.js";
import { Budget, SandboxError } from "./budget.js";
import {
  createIntrinsicObject,
  materializeFunctionProperties,
  markDescriptorObject,
  trackedPropertyStringData,
  trackedPropertySymbols,
  setSandboxPrototype,
  trackedPropertyDataDescriptors
} from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues, type SandboxObject } from "./values.js";

afterEach(() => vi.restoreAllMocks());

it("updates scalar totals without materializing descriptor snapshots during construction", () => {
  const table = createIntrinsicObject();
  let expected = 0;
  for (let index = 0; index < 64; index++) {
    const key = `entry${index}`;
    Object.defineProperty(table, key, {
      value: "translation",
      writable: true,
      enumerable: true,
      configurable: true
    });
    expected += 1 + key.length + 11;
    expect(trackedPropertyStringData(table, false)?.units).toBe(expected);
  }
  Object.defineProperty(table, "entry0", { enumerable: false });
  expect(trackedPropertyStringData(table, false)?.units).toBe(expected - 18);
  expect(trackedPropertyStringData(table, true)?.units).toBe(expected);
  Object.defineProperty(table, "entry1", { writable: false, configurable: false });
  expect(Reflect.defineProperty(table, "entry1", { value: "changed" })).toBe(false);
  expect(trackedPropertyStringData(table, true)?.units).toBe(expected);
  expect(Reflect.deleteProperty(table, "entry2")).toBe(true);
  expect(trackedPropertyStringData(table, true)?.units).toBe(expected - 18);
});

it("keeps owned symbol lists immutable and fresh after native mutations", () => {
  const table = createIntrinsicObject({ payload: "abc" });
  const first = trackedPropertySymbols(table)!;
  expect(first).toEqual([]);
  expect(Object.isFrozen(first)).toBe(true);
  table.payload = "changed";
  expect(trackedPropertySymbols(table)).toBe(first);
  const key = Symbol("callback");
  Object.defineProperty(table, key, { value: 1, configurable: true });
  expect(trackedPropertySymbols(table)).toEqual([key]);
  expect(trackedPropertySymbols(new Proxy(table, {}))).toBeUndefined();
  Reflect.deleteProperty(table, key);
  expect(trackedPropertySymbols(table)).toEqual([]);
});

it("rejects native scalar growth after warming while reconciliation is held", () => {
  const table = createIntrinsicObject({ payload: "small" });
  const before = measureSandboxData([table]);
  const budget = new Budget({ dataSize: before + 100 });
  const resume = budget.deferReconciliation();
  try {
    table.payload = "x".repeat(205);
    expect(measureSandboxData([table]) - before).toBe(200);
    expect(() => reconcileCompiledValues(budget, [table])).toThrow(SandboxError);
  } finally {
    resume();
  }
});

it("matches fresh record accounting across scalar, reference and accessor transitions", () => {
  const table = createIntrinsicObject({ payload: "small" });
  const plain = { payload: "small" };
  markDescriptorObject(table);
  markDescriptorObject(plain);
  let retained = "small";
  const closure = createSandboxClosure({ call: () => undefined, retainedValues: () => [retained] });
  const descriptors: PropertyDescriptor[] = [
    { value: null, writable: true, configurable: true, enumerable: true },
    { value: 255n },
    { value: Symbol("fresh") },
    { value: { text: "child" } },
    { get: accessorAdapter(closure, "get"), enumerable: false },
    { value: "grown", writable: false, configurable: false }
  ];
  for (const descriptor of descriptors) {
    Object.defineProperty(table, "payload", descriptor);
    Object.defineProperty(plain, "payload", descriptor);
    expect(measureSandboxData([table])).toBe(measureSandboxData([plain]));
    retained += "more";
    expect(measureSandboxData([table])).toBe(measureSandboxData([plain]));
  }
  expect(Reflect.deleteProperty(table, "payload")).toBe(false);
  expect(measureSandboxData([table])).toBe(measureSandboxData([plain]));
});

it("does not recapture tracked string descriptors across measurements", () => {
  const table = createIntrinsicObject({ payload: "abc", child: { text: "xyz" } });
  const before = measureSandboxData([table]);
  const names = vi.spyOn(Object, "getOwnPropertyNames");
  const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
  expect(measureSandboxData([table])).toBe(before);
  expect(names.mock.calls.filter(([owner]) => owner === table)).toHaveLength(0);
  expect(
    descriptors.mock.calls.filter(([owner, key]) => owner === table && typeof key === "string")
  ).toHaveLength(0);
});

it("does not recapture owned constructor prototype descriptors across measurements", () => {
  const closure = createSandboxClosure({ guest: true, call: () => undefined, construct: () => ({}) });
  const prototype = materializeFunctionProperties(closure).prototype as SandboxObject;
  prototype.payload = { text: "small" };
  expect(prototype.constructor).toBe(closure);
  const before = measureSandboxData([closure]);
  const names = vi.spyOn(Object, "getOwnPropertyNames");
  const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
  expect(measureSandboxData([closure])).toBe(before);
  expect(names.mock.calls.filter(([owner]) => owner === prototype)).toHaveLength(0);
  expect(descriptors.mock.calls.filter(([owner, key]) => owner === prototype && typeof key === "string"))
    .toHaveLength(0);
});

it.each([false, true])("keeps constructor prototype mutations and descendants under quota (held=%s)", held => {
  const closure = createSandboxClosure({ guest: true, call: () => undefined, construct: () => ({}) });
  const prototype = materializeFunctionProperties(closure).prototype as SandboxObject;
  const child = { text: "small" };
  Object.defineProperty(prototype, "hidden", { value: child, configurable: true });
  const before = measureSandboxData([closure]);
  child.text = "x".repeat(1005);
  expect(measureSandboxData([closure])).toBe(before + 1000);
  const budget = new Budget({ dataSize: before + 500 });
  const release = held ? budget.deferReconciliation() : () => {};
  try {
    expect(() => reconcileCompiledValues(budget, [closure])).toThrow(SandboxError);
  } finally { release(); }
  Reflect.deleteProperty(prototype, "hidden");
  expect(measureSandboxData([closure])).toBeLessThan(before);
  Object.defineProperty(prototype, "constructor", { value: "changed" });
  expect(prototype.constructor).toBe("changed");
  expect(materializeFunctionProperties(closure).prototype).toBe(prototype);
});

it("keeps mutable descendants, writes, hidden fields and deletion live", () => {
  const child = { text: "small" };
  const table = createIntrinsicObject({ child });
  const before = measureSandboxData([table]);
  child.text = "x".repeat(205);
  expect(measureSandboxData([table]) - before).toBe(200);
  Object.defineProperty(table, "hidden", { value: "x".repeat(100), configurable: true });
  const enumerableOnly = measureSandboxData([table]);
  Object.defineProperty(table, "hidden", { enumerable: true });
  expect(measureSandboxData([table]) - enumerableOnly).toBe(107);
  Reflect.deleteProperty(table, "hidden");
  Reflect.deleteProperty(table, "child");
  expect(measureSandboxData([table])).toBe(1);
});

it("observes writes performed by a symbol capture before string fields are measured", () => {
  const table = createIntrinsicObject({ payload: "small" });
  let grow = false;
  const callback = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (grow) {
        grow = false;
        table.payload = "x".repeat(205);
      }
      return [];
    }
  });
  Object.defineProperty(table, Symbol("callback"), { value: callback });
  const before = measureSandboxData([table]);
  grow = true;
  expect(measureSandboxData([table]) - before).toBe(200);
});

it("keeps accessor adapter observations fresh and does not execute native getters", () => {
  let retained = "small";
  const closure = createSandboxClosure({
    call: () => {
      throw new Error("Getter executed");
    },
    retainedValues: () => [retained]
  });
  const table = createIntrinsicObject();
  Object.defineProperty(table, "getter", {
    get: accessorAdapter(closure, "get"),
    enumerable: true
  });
  const before = measureSandboxData([table]);
  retained = "x".repeat(205);
  expect(measureSandboxData([table]) - before).toBe(200);
  const release = new Budget({ dataSize: before + 100 });
  const resume = release.deferReconciliation();
  try {
    expect(() => reconcileCompiledValues(release, [table])).toThrow(SandboxError);
  } finally {
    resume();
  }
});

it("keeps a foreign proxy around a tracked table on the conservative path", () => {
  const table = createIntrinsicObject({ payload: "small" });
  let text = "small";
  const wrapped = new Proxy(table, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return key === "payload" && descriptor ? { ...descriptor, value: text } : descriptor;
    }
  });
  const before = measureSandboxData([wrapped]);
  text = "x".repeat(205);
  expect(measureSandboxData([wrapped]) - before).toBe(200);
});

it("keeps externally supplied restored function tables conservative", () => {
  const closure = createSandboxClosure({ guest: true, call: () => undefined });
  const table = { payload: "small" };
  materializeFunctionProperties(closure, table);
  const before = measureSandboxData([closure]);
  table.payload = "x".repeat(205);
  expect(measureSandboxData([closure]) - before).toBe(200);
});

it("does not expose tracked backing tables through later native creation and mutation hooks", () => {
  const initial = { payload: "small" };
  const create = vi.spyOn(Object, "create");
  const table = createIntrinsicObject(initial);
  expect(create).not.toHaveBeenCalled();
  const define = vi.spyOn(Reflect, "defineProperty");
  const remove = vi.spyOn(Reflect, "deleteProperty");
  Object.defineProperty(table, "extra", { value: 1, configurable: true });
  delete table.extra;
  expect(define).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it("does not expose cache storage through later native WeakMap hooks", () => {
  const get = vi.spyOn(WeakMap.prototype, "get");
  const set = vi.spyOn(WeakMap.prototype, "set");
  const table = createIntrinsicObject({ payload: "small" });
  const before = measureSandboxData([table]);
  table.payload = "x".repeat(205);
  expect(measureSandboxData([table]) - before).toBe(200);
  const written = set.mock.calls.map(([, value]) => value);
  const returned = get.mock.results.map((result) => result.value);
  get.mockRestore();
  set.mockRestore();
  for (const value of written) {
    if (value && typeof value === "object") expect(Object.hasOwn(value, "backing")).toBe(false);
  }
  for (const value of returned) {
    if (value && typeof value === "object") expect(Object.hasOwn(value, "backing")).toBe(false);
  }
});

it("keeps cache records private when an inherited setter observes descriptor writes", () => {
  const define = Object.defineProperty;
  let exposed = false;
  define(Object.prototype, "descriptors", {
    configurable: true,
    set(value) {
      if (Object.hasOwn(this, "backing")) exposed = true;
      define(this, "descriptors", { value, writable: true, configurable: true });
    }
  });
  try {
    const table = createIntrinsicObject({ payload: "small" });
    expect(measureSandboxData([table])).toBe(14);
    expect(exposed).toBe(false);
  } finally {
    Reflect.deleteProperty(Object.prototype, "descriptors");
  }
});

it("keeps cached descriptor containers immutable and replaces them after writes", () => {
  const table = createIntrinsicObject({ payload: "small" });
  const before = trackedPropertyDataDescriptors(table)!;
  expect(Object.isFrozen(before)).toBe(true);
  expect(Object.isFrozen(before[0])).toBe(true);
  expect(Object.isFrozen(before[0]![1])).toBe(true);
  expect(Reflect.set(before[0]![1], "value", "fake")).toBe(false);
  table.payload = "changed";
  expect(trackedPropertyDataDescriptors(table)).not.toBe(before);
  expect(before[0]![1].value).toBe("small");
});

it("observes mutable prototypes before applying cached string descriptors", () => {
  const table = createIntrinsicObject({ payload: "small" });
  let grow = false;
  const callback = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      if (grow) {
        grow = false;
        table.payload = "x".repeat(205);
      }
      return [];
    }
  });
  setSandboxPrototype(table, { callback });
  const before = measureSandboxData([table]);
  grow = true;
  expect(measureSandboxData([table]) - before).toBe(200);
});

it("does not publish generated function property backings during prototype initialization", () => {
  const closure = createSandboxClosure({
    guest: true,
    call: () => undefined,
    construct: () => ({})
  });
  const define = vi.spyOn(Object, "defineProperty");
  materializeFunctionProperties(closure);
  expect(define.mock.calls.filter(([, key]) => key === "prototype")).toHaveLength(0);
});

it("keeps bigint observations fresh instead of caching their conversion charge", () => {
  const table = createIntrinsicObject({ value: 255n, text: "abc" });
  const before = measureSandboxData([table]);
  const stringify = vi.spyOn(BigInt.prototype, "toString").mockReturnValue("xxxx");
  expect(measureSandboxData([table]) - before).toBe(2);
  expect(stringify).toHaveBeenCalledWith(16);
});

it("does not expose descriptor entry reads to later native array iterator hooks", () => {
  const table = createIntrinsicObject({ payload: "small" });
  trackedPropertyDataDescriptors(table);
  const original = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function (this: unknown[]) {
    if (this.length === 2 && this[0] === "payload" && this[1] && typeof this[1] === "object") {
      return original.call(["payload", { ...this[1], value: undefined }]);
    }
    return original.call(this);
  };
  let usage: number;
  try {
    usage = measureSandboxData([table]);
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  expect(usage).toBe(14);
});

it("keeps scalar projections and edge membership immutable in both enumeration modes", () => {
  const child = { text: "abc" };
  const table = createIntrinsicObject({ payload: "abc", child });
  Object.defineProperty(table, "hidden", { value: "xxx" });
  const visible = trackedPropertyStringData(table, false)!;
  const all = trackedPropertyStringData(table, true)!;
  expect(visible.units).toBe(17);
  expect(all.units).toBe(27);
  for (const projection of [visible, all]) {
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.references)).toBe(true);
    expect(Reflect.set(projection, "units", 0)).toBe(false);
    expect(Reflect.set(projection.references, "length", 0)).toBe(false);
    expect(projection.references).toEqual([child]);
  }
  expect(measureSandboxData([table])).toBe(27);
  markDescriptorObject(table);
  expect(measureSandboxData([table])).toBe(37);
});
