import { expect, it, vi } from "vitest";
import { decodeReplayData } from "./replay-data.js";
import { Budget } from "../interp/budget.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { getPromiseProperties, type SandboxPromise } from "../interp/values.js";
import { importedPromisePropertySnapshots } from "../interp/promise-state.js";

it.each([{ tag: "ref", id: 0 }, { tag: "ref", id: 99 }, "invalid"])(
  "rejects malformed pending Promise property reference %j without invoking its provider", properties => {
    const provider = vi.fn(async () => 7);
    const memo = new Map<string, Map<number, SandboxPromise>>();
    expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
      { kind: "pending-imported-promise", properties }
    ] }, { graphId: "call", importedPromiseMemo: memo, resumePendingImportedPromise: provider })).toThrow();
    expect(provider).not.toHaveBeenCalled();
    expect(memo.size).toBe(0);
  }
);

it("rolls back imported property tables and identities after a later allocation failure", () => {
  const provider = vi.fn(async () => 7);
  const memo = new Map<string, Map<number, SandboxPromise>>();
  const captured: SandboxPromise[] = [];
  const property = (value: unknown) => ({ value, configurable: true, enumerable: true, writable: true });
  const ref = (id: number) => ({ tag: "ref", id });
  const budget = new Budget({ stringLength: 128 });
  const operation = budget.acquireCompileOwner(false);
  const compilation = new CompileScope(operation.owner);
  try {
    expect(() => decodeReplayData({ root: ref(0), nodes: [
      { kind: "array", properties: { 0: property(ref(1)), 1: property(ref(3)) }, extensible: true, nullPrototype: false },
      { kind: "pending-imported-promise", properties: ref(2) },
      { kind: "object", properties: { label: property("saved") }, extensible: true, nullPrototype: true },
      { kind: "pending-imported-promise", properties: ref(4) },
      { kind: "object", properties: { data: property("x".repeat(129)) }, extensible: true, nullPrototype: true }
    ] }, { graphId: "call", importedPromiseMemo: memo, resumePendingImportedPromise: provider,
      onImportedPromiseRestored: promise => { captured.push(promise); } }, compilation))
      .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "stringLength" }));
    expect(captured).toHaveLength(2);
    expect(getPromiseProperties(captured[0])).not.toHaveProperty("label");
    expect(importedPromisePropertySnapshots.has(captured[0])).toBe(false);
    expect(memo.size).toBe(0);
    expect(provider).not.toHaveBeenCalled();
  } finally { compilation.dispose(); operation.release(); }
});
