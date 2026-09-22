import { afterEach, expect, it, vi } from "vitest";
import { accessorAdapter } from "./accessors.js";
import { Budget, SandboxError } from "./budget.js";
import {
  createIntrinsicObject,
  materializeFunctionProperties,
  markDescriptorObject,
  trackedPropertyStringData,
  setSandboxPrototype,
  trackedPropertyDataDescriptors
} from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

afterEach(() => vi.restoreAllMocks());

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
