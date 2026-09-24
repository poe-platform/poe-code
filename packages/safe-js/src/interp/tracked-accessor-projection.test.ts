import { expect, it } from "vitest";
import { accessorAdapter } from "./accessors.js";
import { Budget } from "./budget.js";
import {
  createIntrinsicObject,
  markDescriptorObject,
  trackedPropertyStringData
} from "./object-model.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

const callable = () => createSandboxClosure({ call: () => undefined });

it("reuses immutable accessor projections with ordered getter and setter roots", () => {
  const get = callable(),
    set = callable();
  const table = createIntrinsicObject({ label: "abc" });
  Object.defineProperty(table, "visible", {
    get: accessorAdapter(get, "get"),
    set: accessorAdapter(set, "set"),
    enumerable: true,
    configurable: true
  });
  Object.defineProperty(table, "hidden", { get: accessorAdapter(get, "get") });
  const visible = trackedPropertyStringData(table, false);
  const all = trackedPropertyStringData(table, true);
  expect(visible).toEqual({ units: 17, references: [get, set] });
  expect(all).toEqual({ units: 24, references: [get, set, get] });
  expect(trackedPropertyStringData(table, false)).toBe(visible);
  expect(trackedPropertyStringData(table, true)).toBe(all);
  expect(Object.isFrozen(visible)).toBe(true);
  expect(Object.isFrozen(visible!.references)).toBe(true);
  Object.defineProperty(table, "visible", { value: "new", writable: true });
  expect(trackedPropertyStringData(table, false)).toEqual({ units: 20, references: [] });
  expect(visible).toEqual({ units: 17, references: [get, set] });
  Reflect.deleteProperty(table, "visible");
  expect(trackedPropertyStringData(table, false)).toEqual({ units: 9, references: [] });
});

it("counts native accessor fields without executing or inventing retained roots", () => {
  const table = createIntrinsicObject();
  Object.defineProperty(table, "field", {
    get() {
      throw new Error("Native getter executed");
    },
    set() {
      throw new Error("Native setter executed");
    },
    enumerable: true
  });
  expect(trackedPropertyStringData(table, false)).toEqual({ units: 6, references: [] });
  expect(measureSandboxData([table])).toBe(7);
});

it("keeps SDK-owned accessor roots out of later native array iterator hooks", () => {
  const getter = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => ["x".repeat(1000)]
  });
  const table = createIntrinsicObject();
  Object.defineProperty(table, "field", { get: accessorAdapter(getter, "get"), enumerable: true });
  const before = measureSandboxData([table]);
  const iterator = Array.prototype[Symbol.iterator];
  let after = -1;
  try {
    Array.prototype[Symbol.iterator] = function () {
      return iterator.call(this[0] === getter ? [] : this);
    };
    after = measureSandboxData([table]);
  } finally {
    Array.prototype[Symbol.iterator] = iterator;
  }
  expect(before).toBe(1008);
  expect(after).toBe(before);
});

it.each([false, true])("keeps accessor captures fresh after warming (held=%s)", (held) => {
  const payload = { text: "small" };
  let observations = 0;
  const getter = createSandboxClosure({
    call: () => {
      throw new Error("Guest getter executed");
    },
    retainedValues: () => {
      observations++;
      return [payload];
    }
  });
  const table = createIntrinsicObject();
  Object.defineProperty(table, "field", { get: accessorAdapter(getter, "get"), enumerable: true });
  const before = measureSandboxData([table]);
  expect(observations).toBe(1);
  expect(measureSandboxData([table, getter, payload])).toBe(before);
  expect(observations).toBe(2);
  payload.text = "x".repeat(1005);
  const budget = new Budget({ dataSize: before + 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [table])).toThrow(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally {
    release?.();
  }
  expect(observations).toBe(3);
  expect(measureSandboxData([table])).toBe(before + 1000);
});

it("preserves an earlier descriptor snapshot when a getter capture replaces a later setter", () => {
  const table = createIntrinsicObject();
  const order: string[] = [];
  let change = false;
  const replacement = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      order.push("new");
      return ["new"];
    }
  });
  const setter = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      order.push("old");
      return ["old"];
    }
  });
  const getter = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      order.push("get");
      if (change)
        Object.defineProperty(table, "second", { set: accessorAdapter(replacement, "set") });
      return [];
    }
  });
  Object.defineProperty(table, "first", { get: accessorAdapter(getter, "get"), enumerable: true });
  Object.defineProperty(table, "second", {
    set: accessorAdapter(setter, "set"),
    enumerable: true,
    configurable: true
  });
  const before = measureSandboxData([table]);
  order.length = 0;
  change = true;
  expect(measureSandboxData([table])).toBe(before);
  expect(order).toEqual(["get", "old"]);
  order.length = 0;
  expect(measureSandboxData([table])).toBe(before);
  expect(order).toEqual(["get", "new"]);
});

it("preserves provider errors and separate capture state during reentrant measurement", () => {
  const table = createIntrinsicObject();
  const inner = { text: "inner" };
  const failure = new Error("capture failed");
  let fail = true,
    nested = 0;
  const getter = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      nested = measureSandboxData([inner]);
      if (fail) throw failure;
      return [inner];
    }
  });
  Object.defineProperty(table, "field", { get: accessorAdapter(getter, "get"), enumerable: true });
  expect(() => measureSandboxData([table])).toThrow(failure);
  fail = false;
  expect(measureSandboxData([table])).toBe(8 + nested);
  inner.text += "more";
  expect(measureSandboxData([table])).toBe(8 + nested);
});

it.each([false, true])(
  "matches fresh descriptors across accessor transitions (hidden=%s)",
  (hidden) => {
    const getter = callable(),
      setter = callable();
    const table = createIntrinsicObject();
    const plain = {};
    if (hidden) {
      markDescriptorObject(table);
      markDescriptorObject(plain);
    }
    for (const descriptor of [
      { get: accessorAdapter(getter, "get"), enumerable: !hidden, configurable: true },
      { set: accessorAdapter(setter, "set") },
      { get: undefined },
      { value: "text", writable: true },
      { get: accessorAdapter(setter, "get"), set: undefined },
      { enumerable: hidden },
      { configurable: false }
    ]) {
      Object.defineProperty(table, "field", descriptor);
      Object.defineProperty(plain, "field", descriptor);
      expect(measureSandboxData([table])).toBe(measureSandboxData([plain]));
    }
    expect(Reflect.deleteProperty(table, "field")).toBe(false);
    expect(measureSandboxData([table])).toBe(measureSandboxData([plain]));
    expect(trackedPropertyStringData(new Proxy(table, {}), true)).toBeUndefined();
    expect(trackedPropertyStringData(plain, true)).toBeUndefined();
  }
);
