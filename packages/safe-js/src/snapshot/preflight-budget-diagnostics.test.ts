import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

it("retains the wire budget rejection when semantic fields fit the budget", () => {
  const source = "return 0";
  const snapshot = serialize({
    source,
    currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: {} }],
    callStack: [],
    pendingPromises: [],
    moduleBindings: {}
  });
  const budget = new Budget({ dataSize: 12 });
  expect(() => restore(snapshot, { source, budget })).toThrow(
    expect.objectContaining({ code: "budgetExceeded", path: "$.sourceHash" })
  );
  expect(budget.currentDataSize).toBe(0);
});

it("finishes data-safety validation before semantic reads after an early budget error", () => {
  const source = "return 0";
  const snapshot = serialize({
    source,
    currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: {} }],
    callStack: [],
    pendingPromises: [],
    moduleBindings: {}
  });
  const getter = vi.fn(() => {
    throw new Error("host getter executed");
  });
  Object.defineProperty(snapshot.scopeChain[0], "bindings", { get: getter, enumerable: true });
  const budget = new Budget({ dataSize: 12 });
  expect(() => restore(snapshot, { source, budget })).toThrow(
    expect.objectContaining({ code: "invalidType", path: "$.scopeChain[0].bindings" })
  );
  expect(getter).not.toHaveBeenCalled();
  expect(budget.currentDataSize).toBe(0);
});
