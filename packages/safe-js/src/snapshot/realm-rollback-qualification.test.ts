import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { resolveIntrinsicIdentity } from "../interp/intrinsics.js";
import { run } from "../run.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

it("commits provisional restoration accounting without dropping its successful charges", () => {
  const budget = new Budget({ dataSize: 10 });
  budget.chargeDataUsage(3);
  const finish = budget.provisionDataUsage(0);
  budget.chargeDataUsage(4);
  finish(true);
  expect(budget.currentDataSize).toBe(7);
  expect(() => budget.chargeDataUsage(4)).toThrow(expect.objectContaining({ budget: "dataSize" }));
  expect(() => budget.acquireCompileOwner(true).release()).not.toThrow();
});

it("preserves an existing realm when restoration rejects reuse of its intrinsic budget", async () => {
  const result = await run("Number.prototype.saved=9;return Number.prototype");
  if (!result.ok) throw result.error;
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { prototype: result.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const budget = new Budget();
  createBuiltinBindings({ budget });
  const id = '["Number","prototype"]';
  const prototype = resolveIntrinsicIdentity(budget, id);
  Object.defineProperty(prototype, "existing", { value: 7, enumerable: true, configurable: true });
  const before = Object.getOwnPropertyDescriptors(prototype);
  const retained = [...budget.retainedValues()];
  const failure = new Error("final reconciliation refused");
  const reconcile = vi.spyOn(budget, "reconcileCompileData").mockImplementationOnce(() => { throw failure; });
  try {
    expect(() => restore(saved, { source, budget })).toThrow('Snapshot restoration requires a fresh intrinsic realm budget.');
    expect(reconcile).not.toHaveBeenCalled();
    expect.soft(resolveIntrinsicIdentity(budget, id)).toBe(prototype);
    expect.soft(Object.getOwnPropertyDescriptors(prototype)).toEqual(before);
    expect.soft([...budget.retainedValues()]).toEqual(retained);
  } finally { reconcile.mockRestore(); }
});

it("releases partially mutated intrinsics so a failed fresh budget can retry restoration", async () => {
  const result = await run("Number.prototype.saved=9;return Number.prototype");
  if (!result.ok) throw result.error;
  const original = result.returnValue as object;
  const before = Object.getOwnPropertyDescriptors(original);
  const source = "return 0";
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { prototype: result.returnValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const budget = new Budget();
  const failure = new Error("final reconciliation refused");
  const reconcile = vi.spyOn(budget, "reconcileCompileData").mockImplementationOnce(() => { throw failure; });
  try {
    expect(() => restore(saved, { source, budget })).toThrow(failure);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(Object.getOwnPropertyDescriptors(original)).toEqual(before);
    expect.soft([...budget.retainedValues()]).toEqual([]);
    expect.soft(budget.currentDataSize).toBe(0);
    expect.soft(() => restore(saved, { source, budget })).not.toThrow();
    expect(resolveIntrinsicIdentity(budget, '["Number","prototype"]')).toHaveProperty("saved", 9);
  } finally { reconcile.mockRestore(); }
});
