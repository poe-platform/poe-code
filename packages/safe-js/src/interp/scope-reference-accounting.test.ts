import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { scopeDataRoots } from "./scope-data-roots.js";
import { Scope } from "./scope.js";
import { measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each([undefined, null, false, 0])(
  "releases a captured object when its aliased cell becomes %s",
  (replacement) => {
    const object = { text: "old payload" };
    const parent = new Scope();
    parent.declare("value", "let", object);
    parent.declareAlias("alias", "value");
    const child = parent.child();
    const before = child.retainedDataRoots();
    const originalUsage = measureSandboxData([object]);
    expect(measureSandboxData(before)).toBe(originalUsage);
    child.assign("alias", replacement);
    expect(measureSandboxData(child.retainedDataRoots())).toBe(0);
    expect(measureSandboxData(before)).toBe(originalUsage);
    parent.assign("value", object);
    expect(measureSandboxData(child.retainedDataRoots())).toBe(originalUsage);
  }
);

it("releases object references when cells are copied to uncharged values", () => {
  const object = { text: "payload" };
  const scope = new Scope();
  scope.declare("value", "let", object);
  const child = scope.child();
  const before = child.retainedDataRoots();
  child.copyInitializedBindingsFrom(new Scope({ value: 0 }), ["value"]);
  expect(measureSandboxData(child.retainedDataRoots())).toBe(0);
  expect(measureSandboxData(before)).toBe(measureSandboxData([object]));
});

it("deduplicates object and symbol identities while charging separate primitive cells", () => {
  const object = { text: "payload" };
  const symbol = Symbol("token");
  const scope = new Scope({
    first: object,
    second: object,
    symbol,
    sameSymbol: symbol,
    text: "abc",
    sameText: "abc",
    integer: 255n,
    sameInteger: 255n
  });
  scope.declareAlias("textAlias", "text");
  scope.declareAlias("integerAlias", "integer");
  const roots = [...scope.retainedDataRoots(), ...scope.child().retainedDataRoots()];
  expect(measureSandboxData(roots)).toBe(measureSandboxData([object, symbol]) + 10);
});

it("preserves replacement snapshots across object, primitive and symbol values", () => {
  const object = { text: "payload" };
  const scope = new Scope();
  scope.declare("value", "let", object);
  const objects = scope.retainedDataRoots();
  scope.assign("value", "abc");
  const strings = scope.retainedDataRoots();
  const symbol = Symbol("token");
  scope.assign("value", symbol);
  const symbols = scope.retainedDataRoots();
  scope.assign("value", false);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(0);
  expect(measureSandboxData([...objects, ...strings, ...symbols])).toBe(
    measureSandboxData([object, "abc", symbol])
  );
});

it("enforces aggregate held data through scope object references", () => {
  const first = { text: "x".repeat(60) };
  const second = { text: "y".repeat(60) };
  const scope = new Scope({ first });
  const budget = new Budget({ dataSize: 100 });
  const release = budget.deferReconciliation();
  try {
    reconcileCompiledValues(budget, scope.retainedDataRoots());
    expect(budget.currentDataSize).toBe(66);
    scope.declare("second", "const", second);
    expect(() => reconcileCompiledValues(budget, scope.retainedDataRoots())).toThrow(
      expect.objectContaining({
        code: "budgetExceeded",
        budget: "dataSize",
        current: 132
      })
    );
  } finally {
    release();
  }
});

it.each([{ text: "payload" }, Symbol("token")])(
  "uses reference identity directly in the binding accounting group",
  (value) => {
    const scope = new Scope({ value });
    const roots = scope.retainedDataRoots();
    const root = roots[0];
    if (typeof root !== "object" || root === null) throw new Error("Missing group");
    const group = scopeDataRoots.get(root);
    if (!group || !("values" in group)) throw new Error("Missing group values");
    expect(group.values[0]).toBe(value);
  }
);
