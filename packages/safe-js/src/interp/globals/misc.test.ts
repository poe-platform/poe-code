import { describe, expect, it } from "vitest";

import { Budget, SandboxError } from "../budget.js";
import {
  createSandboxClosure,
  createSandboxMap,
  createSandboxPromise,
  createSandboxSet,
  isSandboxMap,
  isSandboxSet,
  type SandboxClosure,
  type SandboxValue
} from "../values.js";
import { createMiscGlobals } from "./misc.js";
import { MAX_DATA_DEPTH } from "../../graph-depth.js";

describe("createMiscGlobals", () => {
  it("exposes coercing numeric globals", () => {
    const globals = createMiscGlobals({ budget: new Budget() });

    expect(call(globals.parseInt, "  12px", 10)).toBe(12);
    expect(call(globals.parseInt, "0x10")).toBe(16);
    expect(call(globals.parseFloat, "  3.5px")).toBe(3.5);
    expect(call(globals.isNaN, "not-a-number")).toBe(true);
    expect(call(globals.isNaN, "12")).toBe(false);
    expect(call(globals.isFinite, "12")).toBe(true);
    expect(call(globals.isFinite, "Infinity")).toBe(false);
    expect(call(globals.parseInt)).toBeNaN();
    expect(call(globals.parseInt, null)).toBeNaN();
    expect(call(globals.parseInt, true)).toBeNaN();
    expect(call(globals.parseInt, "11", 2)).toBe(3);
    expect(call(globals.parseFloat)).toBeNaN();
    expect(call(globals.parseFloat, null)).toBeNaN();
    expect(call(globals.isNaN)).toBe(true);
    expect(call(globals.isNaN, null)).toBe(false);
    expect(call(globals.isNaN, true)).toBe(false);
    expect(call(globals.isFinite)).toBe(false);
    expect(call(globals.isFinite, null)).toBe(true);
    expect(call(globals.isFinite, false)).toBe(true);
  });

  it("deep clones structured sandbox values and preserves cycles", () => {
    const globals = createMiscGlobals({ budget: new Budget() });
    const source: Record<string, SandboxValue> = {
      nested: ["value"]
    };
    source.self = source;

    const clone = call(globals.structuredClone, source) as Record<string, SandboxValue>;

    expect(clone).not.toBe(source);
    expect(clone.nested).toEqual(["value"]);
    expect(clone.nested).not.toBe(source.nested);
    expect(clone.self).toBe(clone);
  });

  it("round-trips at the data-depth limit and rejects deeper graphs deterministically", () => {
    const globals = createMiscGlobals({ budget: new Budget() });
    const allowed = nestedArrays(MAX_DATA_DEPTH);
    const rejected = nestedArrays(5_000);

    expect(call(globals.structuredClone, allowed)).toEqual(allowed);
    expect(() => call(globals.structuredClone, rejected)).toThrowError(
      expect.objectContaining({
        name: "SandboxError",
        code: "budgetExceeded",
        budget: "dataDepth",
        current: MAX_DATA_DEPTH + 1,
        limit: MAX_DATA_DEPTH
      }) satisfies Partial<SandboxError>
    );
  });

  it("allows a cycle that closes at the data-depth limit", () => {
    const globals = createMiscGlobals({ budget: new Budget() });
    const source = nestedArrays(MAX_DATA_DEPTH) as SandboxValue[];
    let leaf = source;
    for (let index = 0; index < MAX_DATA_DEPTH - 1; index += 1) {
      leaf = leaf[0] as SandboxValue[];
    }
    leaf[0] = source;

    const clone = call(globals.structuredClone, source) as SandboxValue[];
    let clonedLeaf = clone;
    for (let index = 0; index < MAX_DATA_DEPTH - 1; index += 1) {
      clonedLeaf = clonedLeaf[0] as SandboxValue[];
    }

    expect(clonedLeaf[0]).toBe(clone);
  });

  it("preserves shared references and null prototypes", () => {
    const globals = createMiscGlobals({ budget: new Budget() });
    const shared = ["value"];
    const source = Object.assign(Object.create(null) as Record<string, SandboxValue>, {
      first: shared,
      second: shared
    });

    const clone = call(globals.structuredClone, source) as Record<string, SandboxValue>;

    expect(Object.getPrototypeOf(clone)).toBeNull();
    expect(clone.first).toBe(clone.second);
    expect(clone.first).not.toBe(shared);
  });

  it("deep clones Map and Set graphs while preserving shared identity and cycles", () => {
    const globals = createMiscGlobals({ budget: new Budget() });
    const shared = { id: "shared" };
    const set = createSandboxSet([shared]);
    const source = createSandboxMap([[shared, set]]);
    source.entries.set("self", source);

    const clone = call(globals.structuredClone, source);

    expect(isSandboxMap(clone)).toBe(true);
    if (!isSandboxMap(clone)) return;
    const [[clonedShared, clonedSet]] = [...clone.entries];
    expect(clone).not.toBe(source);
    expect(clone.entries.get("self")).toBe(clone);
    expect(clonedShared).not.toBe(shared);
    expect(isSandboxSet(clonedSet)).toBe(true);
    if (isSandboxSet(clonedSet)) {
      expect(clonedSet).not.toBe(set);
      expect([...clonedSet.values][0]).toBe(clonedShared);
    }
  });

  it("rejects closures and promises anywhere in the cloned value", () => {
    const globals = createMiscGlobals({ budget: new Budget() });
    const closure = createSandboxClosure({ call: () => undefined, name: "callback" });
    const promise = createSandboxPromise(Promise.resolve("done"));

    expect(() => call(globals.structuredClone, closure)).toThrow(TypeError);
    expect(() => call(globals.structuredClone, { nested: closure })).toThrow(TypeError);
    expect(() => call(globals.structuredClone, promise)).toThrow(TypeError);
    expect(() => call(globals.structuredClone, [promise])).toThrow(TypeError);
  });

  it("charges budgets for cloned strings and arrays", () => {
    const stringGlobals = createMiscGlobals({
      budget: new Budget({ stringLength: 3 })
    });
    const arrayGlobals = createMiscGlobals({
      budget: new Budget({ arrayLength: 1 })
    });

    expect(() => call(stringGlobals.structuredClone, { value: "toolong" })).toThrowError(
      expect.objectContaining({
        budget: "stringLength",
        current: 7,
        limit: 3
      } satisfies Partial<SandboxError>)
    );
    expect(() => call(arrayGlobals.structuredClone, { value: [1, 2] })).toThrowError(
      expect.objectContaining({
        budget: "arrayLength",
        current: 2,
        limit: 1
      } satisfies Partial<SandboxError>)
    );
  });

  it("does not invoke accessors while validating cloneability", () => {
    const globals = createMiscGlobals({ budget: new Budget() });
    const source = {} as Record<string, SandboxValue>;
    let reads = 0;
    Object.defineProperty(source, "value", {
      enumerable: true,
      get() {
        reads += 1;
        return "value";
      }
    });

    expect(() => call(globals.structuredClone, source)).toThrowError(
      "Unsupported sandbox value at <root>.value: accessor property"
    );
    expect(reads).toBe(0);
  });
});

function nestedArrays(depth: number): SandboxValue {
  let value: SandboxValue = "leaf";
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function call(closure: SandboxClosure, ...args: SandboxValue[]): SandboxValue {
  return closure.call(args) as SandboxValue;
}
