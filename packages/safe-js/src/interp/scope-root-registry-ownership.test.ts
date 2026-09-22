import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { Scope } from "./scope.js";
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
