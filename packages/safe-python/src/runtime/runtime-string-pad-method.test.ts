import { describe, expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(source: string) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), text = v.string(source);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[]) => {
    const method = runtimeNativeAttribute(text, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, text, keywords, call };
}
function points(value: RuntimeValue) {
  if (value.kind !== "str") throw new Error("expected string");
  return [...value.value];
}
const expected = (text: string) => [...text].map(c => c.codePointAt(0));

describe("native string padding", () => {
  it("left and right justify by code-point length", () => {
    const { call, v } = fixture("a😀");
    expect(points(call("ljust", [v.integer(4n)]))).toEqual(expected("a😀  "));
    expect(points(call("rjust", [v.integer(4n), v.string("😀")]))).toEqual(expected("😀😀a😀"));
  });
  it("matches Python's parity-dependent centering", () => {
    const odd = fixture("x"), even = fixture("xx");
    expect(points(odd.call("center", [odd.v.integer(4n), odd.v.string("-")]))).toEqual(expected("-x--"));
    expect(points(even.call("center", [even.v.integer(5n), even.v.string("-")]))).toEqual(expected("--xx-"));
  });
  it.each([["-42", "-0042"], ["+42", "+0042"], ["42", "00042"], ["", "00000"], ["-", "-0000"], ["−42", "00−42"], ["a-2", "00a-2"]])("zero-fills %s with only an ASCII leading sign special case", (source, padded) => {
    const { call, v } = fixture(source);
    expect(points(call("zfill", [v.integer(5n)]))).toEqual(expected(padded));
  });
  it("preserves lone surrogates used as content and padding", () => {
    const { call, v } = fixture("\ud800");
    expect(points(call("rjust", [v.integer(3n), v.string("\udc00")]))).toEqual([0xdc00, 0xdc00, 0xd800]);
  });
  it("returns the exact receiver when the width requires no padding", () => {
    const { call, v, text } = fixture("payload");
    for (const name of ["ljust", "rjust", "center", "zfill"]) for (const width of [v.integer(-100n), v.integer(7n), v.true]) expect(call(name, [width])).toBe(text);
  });
  it("validates width before fill, and validates fill even for unchanged output", () => {
    const { call, v } = fixture("payload");
    expect(() => call("center", [v.float(1), v.none])).toThrow("'float' object cannot be interpreted as an integer");
    expect(() => call("center", [v.integer(0n), v.none])).toThrow("The fill character must be a unicode character, not NoneType");
    expect(() => call("center", [v.integer(0n), v.string("ab")])).toThrow("The fill character must be exactly one character long");
    expect(() => call("zfill", [v.integer(1n << 100n)])).toThrow("Python int too large to convert to C ssize_t");
    expect(() => call("zfill", [v.integer(1n << 40n)])).toThrow(ExecutionLimitError);
  });
  it("enforces positional argument counts and rejects keywords", () => {
    const { call, v, keywords } = fixture("");
    expect(() => call("center", [])).toThrow("center expected at least 1 argument, got 0");
    expect(() => call("rjust", [v.true, v.true, v.true])).toThrow("rjust expected at most 2 arguments, got 3");
    expect(() => call("zfill", [])).toThrow("str.zfill() takes exactly one argument (0 given)");
    keywords.items.set(v.string("width"), v.true);
    expect(() => call("ljust", [])).toThrow("str.ljust() takes no keyword arguments");
  });
});
