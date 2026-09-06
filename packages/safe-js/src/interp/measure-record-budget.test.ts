import { describe, expect, it } from "vitest";
import { createSandboxArguments } from "./arguments.js";
import { Budget, SandboxError } from "./budget.js";
import {
  createSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxValue
} from "./values.js";

describe("ordinary-record data accounting", () => {
  it.each([
    { name: "empty", value: {}, units: 1 },
    { name: "undefined", value: { alpha: undefined }, units: 7 },
    { name: "string", value: { word: "abc" }, units: 9 },
    { name: "repeated strings", value: { first: "xy", second: "xy" }, units: 18 },
    { name: "numeric fields", value: { 2: 7, 1: 8 }, units: 5 },
    { name: "non-string scalars", value: { value: null, other: false }, units: 13 }
  ])("counts $name exactly", ({ value, units }) => {
    expect(measureSandboxData([value])).toBe(units);
  });

  it("counts own enumerable string keys without reading accessors", () => {
    let reads = 0;
    const value = Object.create({ inherited: "not charged" });
    Object.defineProperties(value, {
      word: { value: "abc", enumerable: true },
      hidden: { value: "not charged", enumerable: false },
      getter: {
        enumerable: true,
        get() {
          reads += 1;
          throw new Error("getter must not run");
        }
      }
    });
    Object.defineProperty(value, Symbol("counted"), { value: "now charged", enumerable: true });
    // 16 existing units + one property + eight symbol units + eleven payload units.
    expect(measureSandboxData([value])).toBe(36);
    expect(reads).toBe(0);
  });

  it("counts a null-prototype record and an own __proto__ data key", () => {
    const value = Object.create(null);
    Object.defineProperty(value, "__proto__", { value: "abc", enumerable: true });
    expect(measureSandboxData([value])).toBe(14);
  });

  it("counts aliased records once and terminates cycles", () => {
    const child = { word: "abc" };
    const value: Record<string, unknown> = { left: child, right: child };
    value.self = value;
    expect(measureSandboxData([value, child, value])).toBe(26);
  });

  it("counts distinct equal records independently", () => {
    expect(measureSandboxData([{ left: { word: "abc" }, right: { word: "abc" } }])).toBe(30);
    expect(measureSandboxData(["same", "same"])).toBe(8);
  });

  it("remeasures mutations instead of retaining a graph cache", () => {
    const value: Record<string, string> = { one: "a" };
    expect(measureSandboxData([value])).toBe(6);
    value.one = "abc";
    expect(measureSandboxData([value])).toBe(8);
    value.two = "xy";
    expect(measureSandboxData([value])).toBe(14);
    delete value.one;
    expect(measureSandboxData([value])).toBe(7);
  });

  it("uses the complete descriptor snapshot before visiting retained values", () => {
    const value: Record<string, SandboxValue> = {};
    value.first = createSandboxClosure({
      call: () => undefined,
      retainedValues: () => {
        Object.defineProperty(value, "later", { value: "changed", enumerable: false });
        value.added = "not in the captured record";
        return [];
      }
    });
    value.later = "initial";
    expect(measureSandboxData([value])).toBe(21);
    expect(value.later).toBe("changed");
    expect(Object.keys(value)).toEqual(["first", "added"]);
  });

  it("visits integer keys before insertion-ordered other string keys", () => {
    const visits: string[] = [];
    const record: Record<string, SandboxValue> = {};
    for (const name of ["label", "2", "1", "tail"]) {
      record[name] = createSandboxClosure({
        call: () => undefined,
        retainedValues: () => {
          visits.push(name);
          return [];
        }
      });
    }
    expect(measureSandboxData([record])).toBe(20);
    expect(visits).toEqual(["1", "2", "label", "tail"]);
  });

  it("preserves the first retained-value error and stops later visits", () => {
    const failure = new SandboxError("reentry");
    let laterVisits = 0;
    const record = {
      first: createSandboxClosure({
        call: () => undefined,
        retainedValues: () => {
          throw failure;
        }
      }),
      later: createSandboxClosure({
        call: () => undefined,
        retainedValues: () => {
          laterVisits += 1;
          return [];
        }
      })
    };
    const budget = new Budget({ dataSize: 0 });
    expect(() => reconcileCompiledValues(budget, [record])).toThrow(failure);
    try {
      measureSandboxData([record]);
      expect.unreachable("retained-value failure must propagate");
    } catch (error) {
      expect(error).toBe(failure);
    }
    expect(laterVisits).toBe(0);
    expect(budget.currentDataSize).toBe(0);
    expect(budget.peakDataSize).toBe(0);
  });

  it("keeps the existing non-enumerable arguments-length charge", () => {
    const value = createSandboxArguments(["word"]);
    expect(Object.getOwnPropertyDescriptor(value, "length")?.enumerable).toBe(false);
    // Includes the own Symbol.iterator property and its retained symbol identity.
    expect(measureSandboxData([value])).toBe(31);
  });

  it.each([25, 26, 27])("preserves the exact dataSize boundary at %i units", (limit) => {
    const child = { word: "abc" };
    const value: Record<string, unknown> = { left: child, right: child };
    value.self = value;
    const budget = new Budget({ dataSize: limit });
    if (limit < 26) {
      expect(() => reconcileCompiledValues(budget, [value])).toThrowError(
        expect.objectContaining({
          name: "SandboxError",
          code: "budgetExceeded",
          budget: "dataSize",
          current: 26,
          limit
        })
      );
      expect(budget.currentDataSize).toBe(0);
      expect(budget.peakDataSize).toBe(0);
    } else {
      reconcileCompiledValues(budget, [value]);
      expect(budget.currentDataSize).toBe(26);
      expect(budget.peakDataSize).toBe(26);
    }
  });

  it("tracks growing ordinary trace records and releases removed entries", () => {
    const trace: Array<{ event: string; index: number }> = [];
    const budget = new Budget({ dataSize: 100 });
    for (let count = 0; count <= 4; count += 1) {
      if (count > 0) trace.push({ event: "store", index: count });
      reconcileCompiledValues(budget, [trace]);
      expect(budget.currentDataSize).toBe(1 + count * 19);
      expect(budget.peakDataSize).toBe(1 + count * 19);
    }
    trace.length = 0;
    reconcileCompiledValues(budget, [trace]);
    expect(budget.currentDataSize).toBe(1);
    expect(budget.peakDataSize).toBe(77);
  });
});
