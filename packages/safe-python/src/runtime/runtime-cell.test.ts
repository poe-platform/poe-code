import { describe, expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { readRuntimeCell, mutateRuntimeCell } from "./runtime-cell.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeHash } from "./runtime-hash.js";
import { runtimeIterate } from "./runtime-iteration.js";
import { runtimeBinary } from "./runtime-binary.js";
import { ClassFrame } from "./class-frame.js";
import { analyzeModule } from "../analysis.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const compare = (op: string, a: RuntimeValue, b: RuntimeValue, depth = 1000) => runtimeComparison(op, a, b, v, meter, depth).value;
  return { meter, v, compare };
}

describe("concrete closure cell values", () => {
  it("retains shared storage without reading it on wrapping", () => {
    const { v, meter } = fixture(), storage: { content?: { value: RuntimeValue } } = {};
    const cell = v.cell(storage); expect(cell.value).toBe(storage); expect(Object.isFrozen(cell)).toBe(true);
    expect(() => readRuntimeCell(cell, meter)).toThrow("Cell is empty");
    storage.content = { value: v.none }; expect(readRuntimeCell(cell, meter)).toBe(v.none);
    mutateRuntimeCell(cell, { kind: "set", value: v.true }, meter); expect(storage.content.value).toBe(v.true);
    mutateRuntimeCell(cell, { kind: "delete" }, meter); expect(storage.content).toBeUndefined();
    expect(() => mutateRuntimeCell(cell, { kind: "delete" }, meter)).not.toThrow();
  });
  it("publishes the original class construction cell used by method closures", () => {
    const { v, meter } = fixture(), scope = analyzeModule("class C:\n def f(): return __class__\n").scopes.children[0];
    const frame = new ClassFrame<RuntimeValue>(scope, { globals: new Map(), builtins: new Map(), locals: { lookup: () => undefined, store() {}, delete: () => false, isGuest: () => false } }, meter);
    const cell = v.cell(frame.classCell!), captured = frame.capture(scope.children[0]).get("__class__")!;
    mutateRuntimeCell(cell, { kind: "set", value: v.true }, meter); expect(captured.content?.value).toBe(v.true);
    captured.content = { value: v.false }; expect(readRuntimeCell(cell, meter)).toBe(v.false);
  });
  it("orders empty cells before occupied cells and delegates all six operators to contents", () => {
    const { v, compare } = fixture(), empty = v.cell({}), a = v.cell({ content: { value: v.integer(1) } }), b = v.cell({ content: { value: v.integer(2) } });
    const ops = ["==", "!=", "<", "<=", ">", ">="];
    expect(ops.map(op => compare(op, empty, v.cell({})))).toEqual([true, false, false, true, false, true]);
    expect(ops.map(op => compare(op, empty, a))).toEqual([false, true, true, true, false, false]);
    expect(ops.map(op => compare(op, a, empty))).toEqual([false, true, false, false, true, true]);
    expect(ops.map(op => compare(op, a, b))).toEqual([false, true, true, true, false, false]);
  });
  it("does not identity-shortcut cell contents, including NaN", () => {
    const { v, compare } = fixture(), nan = v.float(NaN), a = v.cell({ content: { value: nan } }), b = v.cell({ content: { value: nan } });
    expect(compare("==", a, a)).toBe(false); expect(compare("==", a, b)).toBe(false); expect(compare("!=", a, b)).toBe(true);
    expect(compare("is", a, a)).toBe(true); expect(compare("is", a, b)).toBe(false);
  });
  it("bounds recursive cell comparisons using the shared explicit comparison stack", () => {
    const { v, compare } = fixture(), a = v.cell({}), b = v.cell({});
    a.value.content = { value: a }; b.value.content = { value: b };
    expect(() => compare("==", a, b, 10)).toThrow(expect.objectContaining({ name: "RecursionError" }));
    expect(() => compare("==", a, a, 10)).toThrow(expect.objectContaining({ name: "RecursionError" }));
  });
  it("compares deeply nested cells without using the host call stack", () => {
    const { v, compare } = fixture(); let a: RuntimeValue = v.integer(1), b: RuntimeValue = v.integer(1);
    for (let index = 0; index < 5000; index++) {
      a = v.cell({ content: { value: a } }); b = v.cell({ content: { value: b } });
    }
    expect(compare("==", a, b, 5001)).toBe(true);
  });
  it("is truthy but unhashable and declines numeric and iteration protocols", () => {
    const { v, meter, compare } = fixture(), cell = v.cell({});
    expect(runtimeTruth(cell, meter)).toBe(true); expect(compare("==", cell, v.none)).toBe(false);
    expect(() => compare("<", cell, v.none)).toThrow("'cell' and 'NoneType'");
    expect(() => runtimeHash(v.tuple([cell]), { none: v.none, identity: () => 1n, string: () => 2n, bytes: () => 3n }, meter)).toThrow("unhashable type: 'cell'");
    expect(() => runtimeIterate(cell, v, meter)).toThrow("'cell' object is not iterable");
    expect(runtimeBinary("+", cell, v.integer(1), v, meter)).toBe(v.notImplemented);
  });
  it("charges a replacement before changing shared contents", () => {
    const { v } = fixture(), cell = v.cell({ content: { value: v.true } });
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 0 });
    expect(() => mutateRuntimeCell(cell, { kind: "set", value: v.false }, meter)).toThrow(ExecutionLimitError);
    expect(cell.value.content?.value).toBe(v.true);
  });
  it("observes cancellation before deletion or publishing a cell wrapper", () => {
    const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000, signal: controller.signal }), v = new RuntimeValues(meter);
    const cell = v.cell({ content: { value: v.true } }); controller.abort();
    expect(() => mutateRuntimeCell(cell, { kind: "delete" }, meter)).toThrow(ExecutionLimitError);
    expect(() => v.cell({})).toThrow(ExecutionLimitError); expect(cell.value.content?.value).toBe(v.true);
  });
});
