import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { Scope } from "./scope.js";
import { scopeDataRoots } from "./scope-data-roots.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each(["get", "set"] as const)(
  "does not reveal scope accounting records through later WeakMap.%s hooks",
  (operation) => {
    const scope = new Scope({ text: "x".repeat(1000) });
    const originalGet = WeakMap.prototype.get;
    const originalSet = WeakMap.prototype.set;
    const exposed: Array<{ registry: WeakMap<object, unknown>; root: object }> = [];
    let roots;
    try {
      if (operation === "get") {
        roots = scope.retainedDataRoots();
        WeakMap.prototype.get = function (root: object) {
          const record = originalGet.call(this, root);
          if (record && typeof record === "object" && Object.hasOwn(record, "values")) {
            exposed.push({ registry: this, root });
          }
          return record;
        };
        measureSandboxData(roots);
      } else {
        WeakMap.prototype.set = function (root: object, record: unknown) {
          if (record && typeof record === "object" && Object.hasOwn(record, "values")) {
            exposed.push({ registry: this, root });
          }
          return originalSet.call(this, root, record);
        };
        roots = scope.retainedDataRoots();
      }
    } finally {
      WeakMap.prototype.get = originalGet;
      WeakMap.prototype.set = originalSet;
    }
    for (const { registry, root } of exposed) originalSet.call(registry, root, { values: [] });
    expect(measureSandboxData(roots)).toBe(1000);
    const budget = new Budget({ dataSize: 500 });
    const release = budget.deferReconciliation();
    try {
      expect(() => reconcileCompiledValues(budget, roots!)).toThrow(
        expect.objectContaining({ budget: "dataSize" })
      );
    } finally {
      release();
    }
    expect(exposed).toHaveLength(0);
  }
);

it("observes same-walk scope replacement and keeps earlier root snapshots", () => {
  const scope = new Scope();
  scope.declare("text", "let", "old");
  const before = scope.retainedDataRoots();
  const grow = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      scope.assign("text", "x".repeat(1000));
      return scope.retainedDataRoots();
    }
  });
  expect(measureSandboxData([...before, grow])).toBe(1004);
  expect(measureSandboxData(before)).toBe(3);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(1000);
});

it("keeps descendants live below scope registry records", () => {
  const child = { text: "old" };
  const scope = new Scope({ child });
  const roots = scope.retainedDataRoots();
  const before = measureSandboxData(roots);
  child.text = "x".repeat(1003);
  expect(measureSandboxData(roots)).toBe(before + 1000);
});

it("replaces accounting kinds without changing earlier public snapshots", () => {
  const root = {};
  const child = { text: "retained" };
  const charge = measureSandboxData([child]);
  const states = [
    { value: child },
    { values: [child] },
    { arguments: { read: () => child, capture: () => undefined } },
    { properties: { read: () => child, units: 0 } }
  ];
  const previous = [];
  for (const state of states) {
    scopeDataRoots.set(root, state);
    const snapshot = scopeDataRoots.get(root)!;
    previous.push({ snapshot, key: Object.keys(state)[0] });
    expect(measureSandboxData([root])).toBe(charge);
  }
  scopeDataRoots.set(root, { deferred: {
    chargeIdentity: root,
    read: () => undefined,
    collect: append => append(child)
  } });
  expect(measureSandboxData([root])).toBe(charge + 1);
  scopeDataRoots.set(root, { value: undefined });
  expect(measureSandboxData([root])).toBe(0);
  for (const { snapshot, key } of previous) {
    expect(Object.keys(snapshot)).toEqual([key]);
    expect(Object.getPrototypeOf(snapshot)).toBe(null);
    expect(Object.isFrozen(snapshot)).toBe(true);
  }
});

it("observes registry replacement by an earlier collector in the same walk", () => {
  const root = {};
  scopeDataRoots.set(root, { value: "old" });
  const replace = createSandboxClosure({
    call: () => undefined,
    retainedValues: () => {
      scopeDataRoots.set(root, { values: ["x".repeat(1000)] });
      return [];
    }
  });
  expect(measureSandboxData([replace, root])).toBe(1001);
  expect(() => reconcileCompiledValues(new Budget({ dataSize: 500 }), [root]))
    .toThrow(expect.objectContaining({ budget: "dataSize" }));
});

it("ignores inherited accounting fields during registration and measurement", () => {
  const keys = ["value", "values", "arguments", "deferred", "properties"];
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(Object.prototype, key));
  const root = {};
  let reads = 0;
  let charge;
  try {
    for (const key of keys) Object.defineProperty(Object.prototype, key, {
      __proto__: null,
      configurable: true,
      get: () => { reads++; throw new Error("Inherited accounting field"); }
    });
    scopeDataRoots.set(root, { value: "retained" });
    charge = measureSandboxData([root]);
  } finally {
    for (let index = 0; index < keys.length; index++) {
      const descriptor = descriptors[index];
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, keys[index]!);
      else Object.defineProperty(Object.prototype, keys[index]!, descriptor);
    }
  }
  expect(charge).toBe(8);
  expect(reads).toBe(0);
});
