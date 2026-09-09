import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const method = (receiver: RuntimeValue, name: string) => {
    const value = runtimeNativeAttribute(receiver, name, v, meter);
    if (value.kind !== "builtin_function_or_method") throw new Error("expected bound method");
    return value.value;
  };
  return { v, meter, keywords, method };
}
function points(value: RuntimeValue) {
  if (value.kind !== "str") throw new Error("expected string result");
  return [...value.value];
}
it("returns the exact native string receiver from __str__", () => {
  const { v, meter, keywords, method } = fixture();
  for (const source of [v.string(""), v.string("é😀"), v.stringPoints(Uint32Array.of(0xd800, 0xdc00))]) {
    expect(method(source, "__str__").invoke([], keywords, meter)).toBe(source);
  }
});
it("renders native string __repr__ without combining surrogate code points", () => {
  const { v, meter, keywords, method } = fixture();
  const source = v.stringPoints(Uint32Array.of(39, 0xd800, 0xdc00, 0x1f600));
  expect(points(method(source, "__repr__").invoke([], keywords, meter))).toEqual([...v.string('"\'\\ud800\\udc00😀"').value]);
});
it("renders bytes __str__ and __repr__ as quoted prefixed text", () => {
  const { v, meter, keywords, method } = fixture(), source = v.bytes(Uint8Array.of(0, 39, 255));
  for (const name of ["__str__", "__repr__"]) expect(points(method(source, name).invoke([], keywords, meter))).toEqual([...v.string('b"\\x00\'\\xff"').value]);
});
it("validates keyword arguments before positional counts", () => {
  const { v, meter, keywords, method } = fixture();
  for (const source of [v.string("x"), v.bytes(Uint8Array.of(120))]) for (const name of ["__str__", "__repr__"]) {
    const bound = method(source, name);
    for (const count of [1, 2]) expect(() => bound.invoke(Array(count).fill(v.none), keywords, meter)).toThrow(`expected 0 arguments, got ${count}`);
  }
  keywords.items.set(v.string("x"), v.true);
  for (const source of [v.string("x"), v.bytes(Uint8Array.of(120))]) for (const name of ["__str__", "__repr__"]) {
    expect(() => method(source, name).invoke([v.none], keywords, meter)).toThrow(`wrapper ${name}() takes no keyword arguments`);
  }
});
it("meters invocation even when returning the original string", () => {
  const { v, keywords, method } = fixture(), bound = method(v.string("x"), "__str__"), controller = new AbortController(); controller.abort();
  expect(() => bound.invoke([], keywords, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
});
it("does not expose storage rendering helpers as guest attributes", () => {
  const { v, method } = fixture();
  for (const source of [v.string("x"), v.bytes(Uint8Array.of(120))]) for (const name of ["repr", "fromBytesRepr", "formatField"]) expect(() => method(source, name)).toThrow(expect.objectContaining({ name: "AttributeError" }));
});
it("renders exact signed integers without binary64 narrowing", () => {
  const { v, meter, keywords, method } = fixture();
  for (const number of [0n, 1n, -1n, 123456789012345678901234567890n, -123456789012345678901234567890n]) {
    for (const name of ["__str__", "__repr__"]) expect(points(method(v.integer(number), name).invoke([], keywords, meter))).toEqual([...v.string(number.toString()).value]);
  }
});
it("renders bool names rather than their integer payloads", () => {
  const { v, meter, keywords, method } = fixture();
  for (const name of ["__str__", "__repr__"]) {
    expect(points(method(v.true, name).invoke([], keywords, meter))).toEqual([...v.string("True").value]);
    expect(points(method(v.false, name).invoke([], keywords, meter))).toEqual([...v.string("False").value]);
  }
});
it("applies decimal limits when the integer method is invoked, not retrieved", () => {
  const { v, meter, keywords, method } = fixture(), source = v.integer(10n ** 4300n);
  for (const name of ["__str__", "__repr__"]) {
    const bound = method(source, name);
    expect(() => bound.invoke([], keywords, meter)).toThrow("Exceeds the limit (4300 digits)");
    expect(() => bound.invoke([v.none], keywords, meter)).toThrow("expected 0 arguments, got 1");
  }
});
it("validates numeric wrapper keywords before positional counts", () => {
  const { v, meter, keywords, method } = fixture();
  keywords.items.set(v.string("x"), v.true);
  for (const source of [v.integer(42), v.true, v.false]) for (const name of ["__str__", "__repr__"]) expect(() => method(source, name).invoke([v.none], keywords, meter)).toThrow(`wrapper ${name}() takes no keyword arguments`);
});
it("meters cancellation before integer and bool representation", () => {
  const { v, keywords, method } = fixture(), controller = new AbortController(); controller.abort();
  for (const source of [v.integer(42), v.true]) {
    const bound = method(source, "__repr__");
    expect(() => bound.invoke([], keywords, new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 100, signal: controller.signal }))).toThrow(ExecutionLimitError);
  }
});
