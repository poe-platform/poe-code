import { describe, expect, it, vi } from "vitest";
import { linearizeMro } from "./mro.js";
import { ExecutionBudget } from "./execution-budget.js";

interface Type { readonly name: string; mro: readonly Type[] }

function hierarchy() {
  const object: Type = { name: "object", mro: [] };
  object.mro = Object.freeze([object]);
  function create(name: string, bases: readonly Type[] = [object]): Type {
    const type: Type = { name, mro: [] };
    type.mro = linearizeMro(type, bases, base => base.mro);
    return type;
  }
  return { object, create };
}

describe("C3 method resolution order", () => {
  it("supports root types and single inheritance without mutating bases", () => {
    const { object, create } = hierarchy();
    expect(linearizeMro(object, [], base => base.mro)).toEqual([object]);
    const a = create("A"), b = create("B", [a]);
    expect(b.mro.map(type => type.name)).toEqual(["B", "A", "object"]);
    expect(a.mro.map(type => type.name)).toEqual(["A", "object"]);
    expect(Object.isFrozen(b.mro)).toBe(true);
  });

  it("resolves diamonds by local precedence and includes shared ancestors once", () => {
    const { create } = hierarchy();
    const a = create("A"), b = create("B", [a]), c = create("C", [a]);
    expect(create("D", [b, c]).mro.map(type => type.name)).toEqual(["D", "B", "C", "A", "object"]);
    expect(create("E", [c, b]).mro.map(type => type.name)).toEqual(["E", "C", "B", "A", "object"]);
  });

  it("preserves inherited precedence rather than sorting by graph depth", () => {
    const { create } = hierarchy();
    const d = create("D"), e = create("E"), f = create("F");
    const b = create("B", [e, d]), c = create("C", [d, f]);
    expect(create("A", [b, c]).mro.map(type => type.name)).toEqual(["A", "B", "E", "C", "D", "F", "object"]);
  });

  it("reports the conflicting remaining heads", () => {
    const { create } = hierarchy();
    const x = create("X"), y = create("Y"), a = create("A", [x, y]), b = create("B", [y, x]);
    expect(() => create("C", [a, b])).toThrow("Cannot create a consistent method resolution order (MRO) for bases X, Y");
    expect(() => create("D", [x, a])).toThrow("Cannot create a consistent method resolution order (MRO) for bases X, A");
  });

  it("checks duplicate bases by identity, not class name", () => {
    const { create } = hierarchy();
    const a = create("A"), other = create("A");
    expect(() => create("B", [a, a])).toThrow("duplicate base class A");
    expect(create("B", [a, other]).mro.slice(1, 3)).toEqual([a, other]);
  });

  it("rejects direct and inherited cycles without changing existing MROs", () => {
    const { create } = hierarchy();
    const a = create("A"), b = create("B", [a]);
    const before = a.mro;
    expect(() => linearizeMro(a, [a], base => base.mro)).toThrow("a __bases__ item causes an inheritance cycle");
    expect(() => linearizeMro(a, [b], base => base.mro)).toThrow("a __bases__ item causes an inheritance cycle");
    expect(a.mro).toBe(before);
  });

  it("consumes supplied base linearizations without recursively recomputing them", () => {
    const { create, object } = hierarchy();
    const a = create("A"), b = create("B");
    const getMro = vi.fn((base: Type) => base === a ? [a, b, object] : base.mro);
    const result = linearizeMro({ name: "C", mro: [] } as Type, [a], getMro);
    expect(result.map(type => type.name)).toEqual(["C", "A", "B", "object"]);
    expect(getMro).toHaveBeenCalledTimes(1);
  });

  it("does not rescan complete tails while merging long shared ancestry", () => {
    const chain = Array.from({ length: 2000 }, (_, index) => ({ name: `T${index}` }));
    const left = { name: "Left" }, right = { name: "Right" };
    let reads = 0;
    const leftMro = new Proxy([left, ...chain], { get(target, key, receiver) { if (typeof key === "string" && key !== "length") reads++; return Reflect.get(target, key, receiver); } });
    const rightMro = new Proxy([right, ...chain], { get(target, key, receiver) { if (typeof key === "string" && key !== "length") reads++; return Reflect.get(target, key, receiver); } });
    const result = linearizeMro({ name: "Child" }, [left, right], base => base === left ? leftMro : rightMro);
    expect(result.length).toBe(2003);
    expect(reads).toBeLessThan(30000);
  });

  it("meters setup, cursor storage, and merge work", () => {
    const { create } = hierarchy();
    const a = create("A"), b = create("B");
    const type: Type = { name: "C", mro: [] };
    expect(() => linearizeMro(type, [a, b], base => base.mro, new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 0 }))).toThrow(expect.objectContaining({ reason: "allocation" }));
    expect(() => linearizeMro(type, [a, b], base => base.mro, new ExecutionBudget({ maxSteps: 5, maxAllocatedBytes: 1000 }))).toThrow(expect.objectContaining({ reason: "steps" }));
    expect(type.mro).toEqual([]);
  });

  it("checks cancellation for a root type", () => {
    const controller = new AbortController(); controller.abort();
    expect(() => linearizeMro({ name: "object" }, [], () => [], new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(expect.objectContaining({ reason: "cancelled" }));
  });
});
