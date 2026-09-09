import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(meter: ExecutionMeter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 })) {
  const v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const list = v.list([v.integer(1), v.integer(2), v.integer(1)]);
  const call = (name: string, args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(list, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { meter, v, keywords, list, call };
}

describe("native list methods", () => {
  it.each(["append", "extend", "insert", "pop", "clear", "reverse", "copy", "count", "remove"])("binds and executes %s", name => {
    const { v, list, call } = fixture();
    const args = name === "insert" ? [v.integer(0), v.integer(9)] : name === "extend" ? [v.tuple([v.integer(9)])] : ["append", "count", "remove"].includes(name) ? [v.integer(1)] : [];
    const result = call(name, args);
    if (name === "count") expect(result).toEqual(v.integer(2));
    else if (name === "pop") expect(result).toEqual(v.integer(1));
    else if (name === "copy") { expect(result).not.toBe(list); expect(result).toEqual(list); }
    else expect(result).toBe(v.none);
    const expected = { append: [1, 2, 1, 1], extend: [1, 2, 1, 9], insert: [9, 1, 2, 1], pop: [1, 2], clear: [], reverse: [1, 2, 1], copy: [1, 2, 1], count: [1, 2, 1], remove: [2, 1] }[name]!;
    expect(list.items.snapshot()).toEqual(expected.map(n => v.integer(n)));
  });
  it("extends itself once and copies slots without cloning members", () => {
    const { v, list, call } = fixture(), child = v.list([]); list.items.clear(); list.items.append(child);
    call("extend", [list]); expect(list.items.length).toBe(2);
    const copy = call("copy"); if (copy.kind !== "list") throw new Error("expected list");
    expect(copy.items).not.toBe(list.items); expect(copy.items.get(0n)).toBe(child);
  });
  it("keeps completed extension when a later iterator step fails", () => {
    const { v, list, call } = fixture(); let step = 0;
    const source = v.iterator({ next() { if (step++ === 0) return { done: false, value: v.true }; throw new Error("iteration failed"); } });
    expect(() => call("extend", [source])).toThrow("iteration failed");
    expect(list.items.get(-1n)).toBe(v.true);
  });
  it("validates signed index conversion before empty-pop checks", () => {
    const { v, list, call } = fixture(); list.items.clear();
    expect(() => call("pop", [v.integer(1n << 80n)])).toThrow(expect.objectContaining({ name: "OverflowError" }));
    expect(() => call("insert", [v.none, v.true])).toThrow("'NoneType' object cannot be interpreted as an integer");
    expect(() => call("pop")).toThrow("pop from empty list");
  });
  it("rejects keywords before any mutation", () => {
    const { v, list, keywords, call } = fixture(); keywords.items.set(v.string("x"), v.true);
    expect(() => call("clear")).toThrow("list.clear() takes no keyword arguments"); expect(list.items.length).toBe(3);
  });
  it("checks cancellation before appending a pulled element", () => {
    let cancelled = false;
    const { v, list, call } = fixture({ checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } });
    const source = v.iterator({ next() { cancelled = true; return { done: false, value: v.true }; } });
    expect(() => call("extend", [source])).toThrow(ExecutionLimitError);
    cancelled = false; expect(list.items.length).toBe(3);
  });
});
