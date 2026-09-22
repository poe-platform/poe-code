import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { scopeDataRoots } from "./scope-data-roots.js";
import { Scope } from "./scope.js";
import { measureSandboxData, reconcileCompiledValues } from "./values.js";

function containsRoot(values: unknown[]): boolean {
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (typeof value === "object" && value !== null && scopeDataRoots.get(value) !== undefined)
      return true;
  }
  return false;
}

function verify(scope: Scope, roots: unknown[], exposed: unknown[][]) {
  // The public result stays caller-owned. Private cached vectors must not escape.
  const privateVectors = exposed.filter((vector) => vector !== roots);
  for (const vector of privateVectors) vector.length = 0;
  expect(measureSandboxData(roots)).toBe(1000);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(1000);
  expect(privateVectors).toHaveLength(0);
  const budget = new Budget({ dataSize: 500 });
  const release = budget.deferReconciliation();
  try {
    expect(() => reconcileCompiledValues(budget, roots)).toThrow(
      expect.objectContaining({ budget: "dataSize" })
    );
  } finally {
    release();
  }
}

it("does not pass private root vectors through later native Array.push hooks", () => {
  const scope = new Scope({ text: "x".repeat(1000) });
  const original = Array.prototype.push;
  const exposed: unknown[][] = [];
  let roots: unknown[] = [];
  Array.prototype.push = function (...items: unknown[]) {
    if (containsRoot(items)) original.call(exposed, this);
    return original.apply(this, items);
  };
  try {
    roots = scope.retainedDataRoots();
  } finally {
    Array.prototype.push = original;
  }
  verify(scope, roots, exposed);
});

it("does not pass private root vectors through native Array iterator hooks", () => {
  const scope = new Scope({ text: "x".repeat(1000) });
  const original = Array.prototype[Symbol.iterator];
  const exposed: unknown[][] = [];
  let roots: unknown[] = [];
  Array.prototype[Symbol.iterator] = function () {
    if (containsRoot(this)) exposed.push(this);
    return original.call(this);
  };
  try {
    roots = scope.retainedDataRoots();
    measureSandboxData(roots);
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  verify(scope, roots, exposed);
});

it("does not classify group records using inherited primitive-root fields", () => {
  const scope = new Scope({ text: "x".repeat(1000) });
  const roots = scope.retainedDataRoots();
  let usage = -1;
  Object.defineProperty(Object.prototype, "value", { value: undefined, configurable: true });
  try {
    usage = measureSandboxData(roots);
  } finally {
    Reflect.deleteProperty(Object.prototype, "value");
  }
  expect(usage).toBe(1000);
});

it("retains immutable private records and vectors without freezing guest descendants", () => {
  const child = { text: "old" };
  const scope = new Scope({ child });
  const roots = scope.retainedDataRoots();
  const root = roots[0];
  if (typeof root !== "object" || root === null) throw Error("Missing group root");
  const group = scopeDataRoots.get(root);
  if (group === undefined || !("values" in group)) throw Error("Missing group record");
  expect(Object.isFrozen(group)).toBe(true);
  expect(Object.isFrozen(group.values)).toBe(true);
  const before = measureSandboxData(roots);
  child.text = "longer";
  expect(measureSandboxData(roots)).toBe(before + 3);
  roots.length = 0;
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(before + 3);
});
