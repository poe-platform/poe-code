import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { ScopeDataRootList } from "./scope-data-roots.js";
import { Scope } from "./scope.js";
import { measureSandboxData, reconcileCompiledValues } from "./values.js";

it.each(["get", "set"] as const)(
  "does not consult inherited %s descriptor hooks while capturing binding roots",
  (key) => {
    const scope = new Scope({ payload: "x".repeat(1000) });
    let reads = 0;
    let roots: unknown[] | undefined;
    let failure: unknown;
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      get: () => {
        reads++;
        return undefined;
      }
    });
    try {
      try {
        roots = scope.retainedDataRoots();
      } catch (error) {
        failure = error;
      }
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
    }
    expect(failure).toBeUndefined();
    expect(reads).toBe(0);
    expect(measureSandboxData(roots!)).toBe(1000);
    const budget = new Budget({ dataSize: 500 });
    const resume = budget.deferReconciliation();
    try {
      expect(() => reconcileCompiledValues(budget, roots!)).toThrowError(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
    } finally {
      resume();
    }
  }
);

it("rejects appending to a published immutable snapshot instead of silently losing a root", () => {
  const list = new ScopeDataRootList();
  const payload = { text: "kept" };
  list.append(payload);
  const snapshot = list.snapshot();
  expect(() => list.append({ text: "lost" })).toThrow(TypeError);
  expect(snapshot.length).toBe(1);
  expect(snapshot[0]).toBe(payload);
  expect(Object.isFrozen(snapshot)).toBe(true);
});

it("preserves native prototype hook isolation, undefined slots and guest aliases", () => {
  const list = new ScopeDataRootList();
  const payload = { text: "kept" };
  let writes = 0;
  Object.defineProperty(Array.prototype, "0", {
    configurable: true,
    set: () => {
      writes++;
    }
  });
  let snapshot: readonly unknown[];
  try {
    list.append(undefined);
    list.append(payload);
    list.append(payload);
    snapshot = list.snapshot();
  } finally {
    Reflect.deleteProperty(Array.prototype, "0");
  }
  expect(writes).toBe(0);
  expect(snapshot!).toHaveLength(3);
  expect(Object.hasOwn(snapshot!, 0)).toBe(true);
  expect(snapshot![1]).toBe(payload);
  expect(snapshot![2]).toBe(payload);
  payload.text = "grown";
  expect(measureSandboxData([snapshot![1]])).toBe(measureSandboxData([payload]));
});
