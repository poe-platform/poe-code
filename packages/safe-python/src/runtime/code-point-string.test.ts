import { describe, expect, it } from "vitest";
import { CodePointString } from "./code-point-string.js";
import { parseExpression } from "../expression.js";
import { ExecutionBudget } from "./execution-budget.js";

describe("immutable code-point string storage", () => {
  it.each(["concat", "repeat", "slice"] as const)("allocates only the owned result buffer for %s", operation => {
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 1000 });
    const source = new CodePointString(Uint32Array.of(65, 0xd800, 0xdc00, 0x10000), meter);
    const before = meter.usage.allocatedBytes;
    const result = operation === "concat" ? source.concat(source, meter) : operation === "repeat" ? source.repeat(2, meter) : source.slice(null, null, 2n, meter);
    expect(meter.usage.allocatedBytes - before).toBe(result.length * 4);
    expect(Object.isFrozen(result)).toBe(true);
    expect([...source]).toEqual([65, 0xd800, 0xdc00, 0x10000]);
    expect([...result]).toEqual(operation === "slice" ? [65, 0xdc00] : [65, 0xd800, 0xdc00, 0x10000, 65, 0xd800, 0xdc00, 0x10000]);
  });
  it("fits a generated string into exactly one output-buffer allocation", () => {
    const source = new CodePointString(Uint32Array.of(65, 66));
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 16 });
    expect([...source.repeat(2, meter)]).toEqual([65, 66, 65, 66]);
    expect(meter.usage.allocatedBytes).toBe(16);
  });
  it("does not let an unrelated ownership marker bypass public copying or validation", () => {
    const marker = Symbol("owned") as never, input = Uint32Array.of(65);
    const text = new CodePointString(input, undefined, marker);
    input[0] = 66; expect([...text]).toEqual([65]);
    expect(() => new CodePointString(Uint32Array.of(0x110000), undefined, marker)).toThrow("string code point outside Unicode range");
  });
  it("takes an independent copy of input code points", () => {
    const input = new Uint32Array([65, 0x1f600, 0xd800, 0xdc00, 0]);
    const text = new CodePointString(input);
    input.fill(66);
    expect([...text]).toEqual([65, 0x1f600, 0xd800, 0xdc00, 0]);
    expect(text.length).toBe(5);
    expect(Object.isFrozen(text)).toBe(true);
  });

  it("preserves parsed escape distinctions instead of merging surrogate pairs", () => {
    const expression = parseExpression("'\\U00010000\\ud800\\udc00'");
    if (expression.kind !== "literal" || expression.literalKind !== "string") throw new Error("expected string literal");
    const text = new CodePointString(expression.value);
    expect(text.length).toBe(3);
    expect([...text]).toEqual([0x10000, 0xd800, 0xdc00]);
    expect([...text.slice(null, null, -1n)]).toEqual([0xdc00, 0xd800, 0x10000]);
    expect(text.codePointAt(-1n)).toBe(0xdc00);
  });

  it("accepts all Python code points including surrogates and noncharacters", () => {
    const points = [0, 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xffff, 0x10ffff];
    expect([...new CodePointString(new Uint32Array(points))]).toEqual(points);
  });

  it.each([0x110000, 0xffffffff])("rejects an out-of-range stored code point %s", point => {
    expect(() => new CodePointString(new Uint32Array([point]))).toThrow(expect.objectContaining({ name: "ValueError" }));
  });

  it("indexes by code points with exact negative and huge index handling", () => {
    const text = new CodePointString(new Uint32Array([65, 0x1f600, 66]));
    expect(text.codePointAt(1n)).toBe(0x1f600);
    expect(text.codePointAt(-3n)).toBe(65);
    for (const index of [-4n, 3n, -(1n << 63n), (1n << 63n) - 1n]) {
      expect(() => text.codePointAt(index)).toThrow(expect.objectContaining({ name: "IndexError", message: "string index out of range" }));
    }
    expect(() => new CodePointString(new Uint32Array()).codePointAt(0n)).toThrow(expect.objectContaining({ name: "IndexError" }));
  });

  it("checks 64-bit index conversion before ordinary string bounds", () => {
    const text = new CodePointString(new Uint32Array([65]));
    for (const index of [1n << 63n, -(1n << 63n) - 1n, 10n ** 100n, -(10n ** 100n)]) {
      expect(() => text.codePointAt(index)).toThrow(expect.objectContaining({ name: "IndexError", message: "cannot fit 'int' into an index-sized integer" }));
    }
  });

  it.each([
    [null, null, null, [65, 0x1f600, 0xd800, 0xdc00, 66]],
    [1n, -1n, null, [0x1f600, 0xd800, 0xdc00]],
    [null, null, -1n, [66, 0xdc00, 0xd800, 0x1f600, 65]],
    [null, -1n, -1n, []], [null, null, 2n, [65, 0xd800, 66]],
    [4n, 0n, -2n, [66, 0xd800]], [100n, 200n, null, []],
    [null, null, 10n ** 100n, [65]], [null, null, -(10n ** 100n), [66]]
  ])("slices (%s, %s, %s) without UTF-16 conversion", (start, stop, step, expected) => {
    const text = new CodePointString(new Uint32Array([65, 0x1f600, 0xd800, 0xdc00, 66]));
    expect([...text.slice(start, stop, step)]).toEqual(expected);
    expect(text.length).toBe(5);
  });

  it("validates zero steps even for empty strings", () => {
    expect(() => new CodePointString(new Uint32Array()).slice(null, null, 0n)).toThrow(expect.objectContaining({ name: "ValueError", message: "slice step cannot be zero" }));
  });

  it.each([
    [[0x10000], [0xe000], 1], [[0xd800, 0xdc00], [0x10000], -1],
    [[65], [65, 66], -1], [[65, 66], [65], 1], [[], [], 0],
    [[0, 0xd800], [0, 0xd800], 0], [[65, 0x301], [0xc1], -1]
  ])("compares code-point sequences %s and %s lexicographically", (left, right, expected) => {
    const a = new CodePointString(new Uint32Array(left)), b = new CodePointString(new Uint32Array(right));
    expect(a.compare(b)).toBe(expected);
    expect(b.compare(a)).toBe(expected === 0 ? 0 : -expected);
  });
});
