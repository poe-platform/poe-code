import { expect, it } from "vitest";
import { createRuntimePercentBindingContext } from "./runtime-percent-binding.js";
import { bindPercentFormat } from "./percent-format-bind.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { createRange } from "./integer-sequence.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const dict = () => v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => runtimeComparison("==", a, b, v, meter).value }, meter));
  const context = createRuntimePercentBindingContext(v, meter);
  const bind = (source: Extract<RuntimeValue, { kind: "str" | "bytes" }>, args: RuntimeValue) => [...bindPercentFormat(source.value, args, context, meter)];
  return { v, meter, dict, context, bind };
}
it("binds runtime tuples and bool/int star operands without narrowing", () => {
  const { v, bind } = fixture(), member = v.list([]);
  const field = bind(v.string("%*.*s"), v.tuple([v.true, v.integer(2), member]))[0];
  expect(field).toMatchObject({ kind: "conversion", argument: member, width: 1n, precision: 2n });
  expect(() => bind(v.string("%*s"), v.tuple([v.float(1), member]))).toThrow("* wants int");
});
it("constructs correctly typed mapping keys and retains mapped tuple identity", () => {
  const { v, bind, dict } = fixture(), mapping = dict(), member = v.tuple([v.true]);
  mapping.items.set(v.string("x"), member); mapping.items.set(v.bytes(Uint8Array.of(120)), v.false);
  expect(bind(v.string("%(x)s"), mapping)[0]).toMatchObject({ argument: member });
  expect(bind(v.bytes(Uint8Array.of(37, 40, 120, 41, 115)), mapping)[0]).toMatchObject({ argument: v.false });
  expect(bind(v.string("%(x)s"), v.mappingProxy(mapping))[0]).toMatchObject({ argument: member });
});
it("preserves separate surrogate code points in mapping keys", () => {
  const { v, bind, dict } = fixture(), mapping = dict();
  mapping.items.set(v.stringPoints(Uint32Array.of(0x10000)), v.false);
  mapping.items.set(v.stringPoints(Uint32Array.of(0xd800, 0xdc00)), v.true);
  const format = v.stringPoints(Uint32Array.of(37, 40, 0xd800, 0xdc00, 41, 115));
  expect(bind(format, mapping)[0]).toMatchObject({ argument: v.true });
});
it("retains missing mapping keys in PythonKeyError without premature rendering", () => {
  const { v, bind, dict } = fixture();
  for (const source of [v.string("%(x)s"), v.bytes(Uint8Array.of(37, 40, 120, 41, 115))]) {
    let caught: unknown; try { bind(source, dict()); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(PythonKeyError);
    expect((caught as PythonKeyError).args[0].kind).toBe(source.kind);
  }
});
it("matches mapping eligibility and sequence-key errors for text versus bytes", () => {
  const { v, bind, dict } = fixture(), text = v.string("plain"), bytes = v.bytes(Uint8Array.of(112));
  for (const value of [v.list([]), v.range(createRange(0n, 0n)), dict()]) {
    expect(bind(text, value)).toHaveLength(1); expect(bind(bytes, value)).toHaveLength(1);
  }
  expect(bind(text, v.bytes(Uint8Array.of(120)))).toHaveLength(1);
  expect(() => bind(bytes, v.bytes(Uint8Array.of(120)))).toThrow("not all arguments converted during bytes formatting");
  expect(() => bind(v.string("%(x)s"), v.list([]))).toThrow("list indices must be integers or slices, not str");
  expect(() => bind(v.string("%(x)s"), v.bytes(Uint8Array.of(120)))).toThrow("byte indices must be integers or slices, not str");
  expect(() => bind(v.string("%(x)s"), v.string("x"))).toThrow("format requires a mapping");
});
it("uses explicit guest mapping and integer-subclass capabilities", () => {
  const { v, meter } = fixture(), source = v.cell({}), number = v.cell({}), seen: RuntimeValue[] = [];
  const mapping = { has: (value: RuntimeValue) => value === source, get(value: RuntimeValue, key: RuntimeValue) { expect(this).toBe(mapping); expect(value).toBe(source); seen.push(key); return number; } };
  const context = createRuntimePercentBindingContext(v, meter, { mapping, integer: value => value === number ? 3n : undefined });
  const field = [...bindPercentFormat(v.string("%*s").value, v.tuple([number, v.true]), context, meter)][0];
  expect(field).toMatchObject({ width: 3n, argument: v.true });
  expect([...bindPercentFormat(v.string("%(x)s").value, source, context, meter)][0]).toMatchObject({ argument: number });
  expect(seen).toEqual([v.string("x")]);
});
it("checks cancellation after custom mapping lookup", () => {
  const { v } = fixture(); let cancelled = false;
  const meter = { checkpoint() { if (cancelled) throw new ExecutionLimitError("cancelled"); } };
  const context = createRuntimePercentBindingContext(v, meter, { mapping: { has: () => true, get: () => { cancelled = true; return v.true; } } });
  expect(() => [...bindPercentFormat(v.string("%(x)s").value, v.cell({}), context, meter)]).toThrow(ExecutionLimitError);
});
