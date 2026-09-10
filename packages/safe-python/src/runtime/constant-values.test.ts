import { describe, expect, it } from "vitest";
import { ConstantValues, type ConstantValue } from "./constant-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { parseExpression } from "../expression.js";
import { analyzeModule } from "../analysis.js";
import { compileProgram } from "./program-compilation.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 });
  return { meter, values: new ConstantValues(meter) };
}

describe("concrete immutable constants", () => {
  it("caches the empty tuple lazily within one value factory", () => {
    const { values, meter } = fixture(), before = meter.usage.allocatedBytes;
    const first = values.tuple([]);
    expect(meter.usage.allocatedBytes - before).toBe(32);
    const allocated = meter.usage.allocatedBytes;
    expect(values.tuple([])).toBe(first);
    expect(values.tuple(0, () => { throw Error("empty reader must not run"); })).toBe(first);
    expect(meter.usage.allocatedBytes).toBe(allocated);
    expect(fixture().values.tuple([])).not.toBe(first);
    expect(() => values.tuple(0 as never)).toThrow("tuple item reader is required");
  });
  it("builds tuple slots directly from a trusted indexed reader", () => {
    const { values, meter } = fixture(), member = { mutable: true }, calls: number[] = [], before = meter.usage.allocatedBytes;
    const tuple = values.tuple(3, index => { calls.push(index); return member; });
    expect(calls).toEqual([0, 1, 2]); expect(tuple.items).toEqual([member, member, member]);
    expect(tuple.items.every(value => value === member)).toBe(true);
    expect(Object.isFrozen(tuple.items)).toBe(true); expect(Object.isFrozen(member)).toBe(false);
    expect(meter.usage.allocatedBytes - before).toBe(32 + 3 * 8);
  });
  it("does not invoke indexed readers for empty tuples or rejected allocations", () => {
    const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 239 }), values = new ConstantValues(meter), calls: number[] = [];
    expect(values.tuple(0, index => { calls.push(index); return index; }).items).toEqual([]);
    expect(() => values.tuple(2, index => { calls.push(index); return index; })).toThrow(ExecutionLimitError);
    expect(calls).toEqual([]);
  });
  it("validates indexed tuple lengths and requires a reader", () => {
    const { values } = fixture();
    for (const length of [-1, .5, Infinity]) expect(() => values.tuple(length, () => 1)).toThrow("tuple length must be a nonnegative safe integer");
    expect(() => values.tuple(1 as never)).toThrow("tuple item reader is required");
  });
  it("propagates indexed-reader failures without visiting later slots", () => {
    const { values } = fixture(), calls: number[] = [], error = new Error("reader failed");
    expect(() => values.tuple(3, index => { calls.push(index); if (index === 1) throw error; return index; })).toThrow(error);
    expect(calls).toEqual([0, 1]);
  });
  it("reuses immutable string and bytes storage without copying its payload", () => {
    const { values, meter } = fixture(), string = values.string("abc"), bytes = values.bytes(Uint8Array.of(1, 2));
    const before = meter.usage.allocatedBytes;
    expect(values.stringPoints(string.value).value).toBe(string.value);
    expect(values.bytes(bytes.value).value).toBe(bytes.value);
    expect(meter.usage.allocatedBytes - before).toBe(64);
  });
  it("preserves per-runtime singleton identity and distinct boolean/integer kinds", () => {
    const { values } = fixture();
    expect(values.boolean(true)).toBe(values.true); expect(values.boolean(false)).toBe(values.false);
    expect(values.true.kind).toBe("bool"); expect(values.integer(1).kind).toBe("int");
    expect(values.none.kind).toBe("none"); expect(values.ellipsis.kind).toBe("ellipsis");
    expect(values.notImplemented.kind).toBe("not-implemented");
    expect(values.none).not.toBe(fixture().values.none);
    for (const value of [values.none, values.true, values.false, values.ellipsis, values.notImplemented]) expect(Object.isFrozen(value)).toBe(true);
  });
  it("retains arbitrary-size integers without a float round trip", () => {
    const { values } = fixture(), integer = (1n << 1000n) + 1n;
    expect(values.integer(integer).value).toBe(integer);
    expect(values.integer(42).value).toBe(42n);
    expect(() => values.integer(Number.MAX_SAFE_INTEGER + 1)).toThrow("integer constant requires a bigint or safe integer");
  });
  it("retains floating point signed zero, infinities and NaN", () => {
    const { values } = fixture();
    expect(Object.is(values.float(-0).value, -0)).toBe(true);
    expect(values.float(Infinity).value).toBe(Infinity);
    expect(Number.isNaN(values.float(NaN).value)).toBe(true);
    expect(values.complex(-0, -Infinity)).toEqual({ kind: "complex", real: -0, imaginary: -Infinity });
  });
  it("copies code-point input without merging surrogate pairs", () => {
    const { values } = fixture(), points = Uint32Array.of(0x10000, 0xd800, 0xdc00);
    const value = values.stringPoints(points); points.fill(0);
    expect([...value.value]).toEqual([0x10000, 0xd800, 0xdc00]);
    expect(Object.isFrozen(value)).toBe(true);
  });
  it("converts host metadata strings using Unicode code points", () => {
    const { values } = fixture();
    expect([...values.string("A😀\ud800").value]).toEqual([65, 0x1f600, 0xd800]);
  });
  it("copies byte literals into immutable owned storage", () => {
    const { values, meter } = fixture(), input = Uint8Array.of(0, 127, 255);
    const value = values.bytes(input); input.fill(1); value.value.toUint8Array(meter).fill(2);
    expect([...value.value]).toEqual([0, 127, 255]); expect(Object.isFrozen(value)).toBe(true);
  });
  it("owns tuple slots without freezing or copying referenced guest values", () => {
    const { values } = fixture(), mutable = { value: 1 }, input = [mutable];
    const tuple = values.tuple(input); input.length = 0; mutable.value = 2;
    expect(tuple.items).toEqual([{ value: 2 }]); expect(tuple.items[0]).toBe(mutable);
    expect(Object.isFrozen(tuple)).toBe(true); expect(Object.isFrozen(tuple.items)).toBe(true);
    expect(Object.isFrozen(mutable)).toBe(false);
  });
  it.each([
    ["None", "none"], ["True", "bool"], ["False", "bool"], ["...", "ellipsis"],
    ["12345678901234567890", "int"], ["1.25", "float"], ["3j", "complex"], ["'text'", "str"], ["b'bytes'", "bytes"]
  ])("materializes parsed literal %s as %s", (source, kind) => {
    const { values } = fixture(), node = parseExpression(source);
    if (node.kind !== "literal") throw new Error("expected literal");
    expect(values.literal(node).kind).toBe(kind);
  });
  it("supplies concrete constant values directly to program compilation", () => {
    const { values, meter } = fixture();
    const program = compileProgram<ConstantValue>(analyzeModule('"module doc"\nclass C:\n def f(self): self.x=1'), { stripDocstring: false }, values, meter);
    expect(program.module.docstring!.value.kind).toBe("str");
    const code = [...program.classes.values()][0];
    expect(code.qualifiedName.kind).toBe("str"); expect(code.firstLine).toEqual({ kind: "int", value: 2n });
    expect(code.staticAttributes.kind).toBe("tuple");
    if (code.staticAttributes.kind === "tuple") expect(code.staticAttributes.items.map(value => value.kind)).toEqual(["str"]);
  });
  it("charges tagged values and tuple slots using the documented logical allocation policy", () => {
    const { values, meter } = fixture(), before = meter.usage.allocatedBytes;
    const integer = values.integer(1n); expect(meter.usage.allocatedBytes - before).toBe(128); // tag, lazy map and cache entry
    const tupleStart = meter.usage.allocatedBytes;
    values.tuple([integer, values.none]); expect(meter.usage.allocatedBytes - tupleStart).toBe(48);
  });
  it("rejects allocation before creating runtime singletons", () => {
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 159 });
    expect(() => new ConstantValues(meter)).toThrow(ExecutionLimitError);
    expect(meter.usage.allocatedBytes).toBe(0);
  });
  it("permits singleton reuse without allocating another tagged object", () => {
    const meter = new ExecutionBudget({ maxSteps: 1000, maxAllocatedBytes: 160 }), values = new ConstantValues(meter);
    expect(values.boolean(true)).toBe(values.true);
    expect(meter.usage.allocatedBytes).toBe(160);
    expect(() => values.integer(0n)).toThrow(ExecutionLimitError);
  });
});
