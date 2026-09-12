import { expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";

it("uses explicit input identities without confusing equal descriptions", () => {
  const first = Symbol("same"), second = Symbol("same");
  const graph = encodeReplayData([first, second, first], { identifyInputSymbol: value => value === first ? 3 : 4 });
  expect(graph.nodes).toHaveLength(1);
  const values = decodeReplayData(graph, { resolveInputSymbol: id => id === 3 ? first : second });
  expect(values).toEqual([first, second, first]);
});

it.each([-1, 0.5, "0", undefined, null, Infinity])("rejects invalid input symbol id %s before resolution", id => {
  const resolveInputSymbol = vi.fn(() => Symbol());
  expect(() => decodeReplayData({ root: { tag: "input-symbol", id }, nodes: [] }, { resolveInputSymbol })).toThrow();
  expect(resolveInputSymbol).not.toHaveBeenCalled();
});

it("rejects a reference without its explicit input symbol", () => {
  expect(() => decodeReplayData({ root: { tag: "input-symbol", id: 0 }, nodes: [] })).toThrow("Missing replay input symbol");
});

it("checks referenced descriptions and rolls back failed decoding allocations", () => {
  const budget = new Budget({ stringLength: 128 });
  const operation = budget.acquireCompileOwner(false);
  const compilation = new CompileScope(operation.owner);
  const before = budget.currentDataSize;
  try {
    expect(() => decodeReplayData({ root: { tag: "input-symbol", id: 0 }, nodes: [] }, {
      resolveInputSymbol: () => Symbol("x".repeat(129))
    }, compilation)).toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "stringLength" }));
    expect(budget.currentDataSize).toBe(before);
  } finally { compilation.dispose(); operation.release(); }
});
