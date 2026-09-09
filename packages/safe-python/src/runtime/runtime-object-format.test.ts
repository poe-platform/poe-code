import { expect, it } from "vitest";
import { createRuntimeFormatContext } from "./runtime-format.js";
import { formatObject } from "./format-protocol.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { createRange } from "./integer-sequence.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const dictionary = () => constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const context = createRuntimeFormatContext(v, meter, { defaultRepr() { throw Error("unresolved representation"); } });
  return { v, meter, dictionary, context };
}
const text = (value: RuntimeValue) => { if (value.kind !== "str") throw Error("expected str"); return String.fromCodePoint(...value.value); };
it("dispatches native complex formatting through the shared protocol", () => {
  const { v, meter, context, dictionary } = fixture();
  expect(text(formatObject(v.complex(-0, 2), v.string("z.2"), context, meter))).toBe("(0+2j)");
  const method = runtimeNativeAttribute(v.complex(1, 2), "__format__", v, meter);
  if (method.kind !== "builtin_function_or_method") throw Error("expected method");
  expect(text(method.value.invoke([v.string(".2f")], dictionary(), meter))).toBe("1.00+2.00j");
});
it("dispatches native float specs through the shared formatting protocol", () => {
  const { v, meter, context, dictionary } = fixture();
  expect(text(formatObject(v.float(-0.0001), v.string("+z08.2f"), context, meter))).toBe("+0000.00");
  expect(text(formatObject(v.true, v.string(".1%"), context, meter))).toBe("100.0%");
  const method = runtimeNativeAttribute(v.float(1.25), "__format__", v, meter);
  if (method.kind !== "builtin_function_or_method") throw Error("expected method");
  expect(text(method.value.invoke([v.string(".1f")], dictionary(), meter))).toBe("1.2");
});
it("dispatches native integer and boolean nonempty format specs", () => {
  const { v, meter, context, dictionary } = fixture();
  expect(text(formatObject(v.integer(-1234), v.string("010,d"), context, meter))).toBe("-0,001,234");
  expect(text(formatObject(v.true, v.string("+d"), context, meter))).toBe("+1");
  expect(text(formatObject(v.false, v.string(" "), context, meter))).toBe(" 0");
  const method = runtimeNativeAttribute(v.integer(65), "__format__", v, meter);
  if (method.kind !== "builtin_function_or_method") throw Error("expected method");
  expect(text(method.value.invoke([v.string("c")], dictionary(), meter))).toBe("A");
});
it("formats native numeric values with empty and omitted specifications", () => {
  const { v, meter, context } = fixture();
  for (const [value, expected] of [[v.true, "True"], [v.false, "False"], [v.integer(-71), "-71"], [v.float(-0), "-0.0"], [v.float(Infinity), "inf"], [v.float(NaN), "nan"], [v.complex(1, -2), "(1-2j)"], [v.complex(-0, -0), "(-0-0j)"]] as const) {
    expect(text(formatObject(value, undefined, context, meter))).toBe(expected);
    expect(text(formatObject(value, v.string(""), context, meter))).toBe(expected);
  }
});
it("exposes numeric format slots with bound method argument validation", () => {
  const { v, meter, dictionary } = fixture(), keywords = dictionary();
  for (const value of [v.true, v.integer(17), v.float(1.5), v.complex(1, 2)]) {
    const method = runtimeNativeAttribute(value, "__format__", v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(method.value.invoke([v.string("")], keywords, meter).kind).toBe("str");
    expect(() => method.value.invoke([], keywords, meter)).toThrow(`${value.kind}.__format__() takes exactly one argument (0 given)`);
    expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("__format__() argument must be str, not None");
    keywords.items.set(v.string("spec"), v.string(""));
    expect(() => method.value.invoke([], keywords, meter)).toThrow(`${value.kind}.__format__() takes no keyword arguments`);
    keywords.items.clear();
  }
});
it("formats implemented native object families with empty specs", () => {
  const { v, meter, dictionary, context } = fixture(), d = dictionary();
  const cases = [[v.none, "None"], [v.ellipsis, "Ellipsis"], [v.notImplemented, "NotImplemented"], [v.bytes(Uint8Array.of(255)), "b'\\xff'"], [v.list([]), "[]"], [v.tuple([]), "()"], [d, "{}"], [v.mappingProxy(d), "{}"], [v.dictionaryView(d, "dict_keys"), "dict_keys([])"], [v.dictionaryView(d, "dict_values"), "dict_values([])"], [v.dictionaryView(d, "dict_items"), "dict_items([])"], [v.range(createRange(0n, 2n, 1n)), "range(0, 2)"]] as const;
  for (const [value, expected] of cases) expect(text(formatObject(value, v.string(""), context, meter))).toBe(expected);
});
it("rejects nonempty specs before traversing unresolved container contents", () => {
  const { v, meter, context } = fixture();
  expect(() => formatObject(v.list([v.cell({})]), v.string("x"), context, meter)).toThrow("unsupported format string passed to list.__format__");
  expect(() => formatObject(v.none, v.string("x"), context, meter)).toThrow("unsupported format string passed to NoneType.__format__");
});
it("exposes native bound object-format methods with their argument diagnostics", () => {
  const { v, meter, dictionary } = fixture(), keywords = dictionary();
  for (const [value, type] of [[v.none, "NoneType"], [v.list([]), "list"], [v.bytes(new Uint8Array()), "bytes"]] as const) {
    const method = runtimeNativeAttribute(value, "__format__", v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected method");
    expect(() => method.value.invoke([], keywords, meter)).toThrow(`${type}.__format__() takes exactly one argument (0 given)`);
    expect(() => method.value.invoke([v.integer(1)], keywords, meter)).toThrow("__format__() argument must be str, not int");
    expect(() => method.value.invoke([v.string("x")], keywords, meter)).toThrow(`unsupported format string passed to ${type}.__format__`);
    expect(method.value.invoke([v.string("")], keywords, meter).kind).toBe("str");
    keywords.items.set(v.string("format_spec"), v.string(""));
    expect(() => method.value.invoke([], keywords, meter)).toThrow(`${type}.__format__() takes no keyword arguments`);
    keywords.items.clear();
  }
});
it("formats native strings through the shared protocol preserving unchanged identity", () => {
  const { v, meter, context } = fixture(), value = v.string("😀ab");
  for (const spec of ["", "s", "2s", ".9s"]) expect(formatObject(value, v.string(spec), context, meter)).toBe(value);
  expect(text(formatObject(value, v.string(".^6.2s"), context, meter))).toBe("..😀a..");
  expect(() => formatObject(value, v.string("+s"), context, meter)).toThrow("Sign not allowed in string format specifier");
});
it("exposes str format methods with native argument validation and rendering", () => {
  const { v, meter, dictionary } = fixture(), value = v.string("abc"), keywords = dictionary();
  const method = runtimeNativeAttribute(value, "__format__", v, meter);
  if (method.kind !== "builtin_function_or_method") throw Error("expected method");
  expect(method.value.invoke([v.string("s")], keywords, meter)).toBe(value);
  expect(text(method.value.invoke([v.string(">5")], keywords, meter))).toBe("  abc");
  expect(() => method.value.invoke([], keywords, meter)).toThrow("str.__format__() takes exactly one argument (0 given)");
  expect(() => method.value.invoke([v.none], keywords, meter)).toThrow("__format__() argument must be str, not None");
  keywords.items.set(v.string("format_spec"), v.string(""));
  expect(() => method.value.invoke([], keywords, meter)).toThrow("str.__format__() takes no keyword arguments");
});
it("preserves live cycles, guest representation hooks and guest format slots", () => {
  const { v, meter, dictionary } = fixture(), guest = v.cell({}), result = v.string("guest"), list = v.list([guest]), d = dictionary();
  list.items.append(list);
  const context = createRuntimeFormatContext(v, meter, {
    lookupRepr: value => value === guest ? () => result : undefined,
    lookupFormat: value => value === guest ? spec => spec : undefined,
    defaultRepr() { throw Error("unexpected default"); }
  });
  expect(text(formatObject(list, undefined, context, meter))).toBe("[guest, [...]]");
  expect(formatObject(guest, result, context, meter)).toBe(result);
  d.items.set(v.string("proxy"), v.mappingProxy(d));
  expect(text(formatObject(v.mappingProxy(d), undefined, context, meter))).toBe("{'proxy': mappingproxy({...})}");
});
