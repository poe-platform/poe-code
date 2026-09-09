import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";
import { runtimeComparison } from "./runtime-comparison.js";
import { PythonKeyError } from "./runtime-dictionary-access.js";
import { createRuntimeBraceFormatMethod } from "./runtime-brace-format-method.js";
import { createRuntimeFormatContext } from "./runtime-format.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keys = { hash: () => 1n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, v, meter).value };
  const dictionary = (entries: readonly (readonly [RuntimeValue, RuntimeValue])[] = []) => {
    const result = constructRuntimeDictionary([], new Map(), v, keys, meter);
    for (const [key, value] of entries) result.items.set(key, value);
    return result;
  };
  const call = (source: RuntimeValue, name: "format" | "format_map", args: readonly RuntimeValue[], keywords = dictionary()) => {
    const method = runtimeNativeAttribute(source, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected bound method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, meter, dictionary, call };
}
it("exposes bound string formatting with positional and keyword fields", () => {
  const { v, call, dictionary } = fixture();
  expect(call(v.string("{0.real:.1f}|{x[1]}|{2:>{1}}"), "format", [v.complex(1.25, 2), v.integer(4), v.string("z")], dictionary([[v.string("x"), v.list([v.integer(8), v.integer(9)])]]))).toEqual(v.string("1.2|9|   z"));
  expect(call(v.string("{} {}"), "format", [v.integer(1), v.integer(2), v.integer(3)])).toEqual(v.string("1 2"));
});
it("validates format_map arguments before parsing but defers mapping access", () => {
  const { v, call, dictionary } = fixture();
  expect(() => call(v.string("{"), "format_map", [])).toThrow("str.format_map() takes exactly one argument (0 given)");
  expect(() => call(v.string("{"), "format_map", [v.none, v.none])).toThrow("str.format_map() takes exactly one argument (2 given)");
  expect(() => call(v.string("{"), "format_map", [], dictionary([[v.string("mapping"), v.none]]))).toThrow("str.format_map() takes no keyword arguments");
  const source = v.string("literal"); expect(call(source, "format_map", [v.none])).toBe(source);
  expect(() => call(v.string("{x}"), "format_map", [v.none])).toThrow("'NoneType' object is not subscriptable");
});
it("looks up mapping fields and retains missing-key exception arguments", () => {
  const { v, call, dictionary } = fixture();
  expect(call(v.string("{x!r}"), "format_map", [dictionary([[v.string("x"), v.string("é")]])])).toEqual(v.string("'é'"));
  for (const name of ["format", "format_map"] as const) {
    try { call(v.string("{missing}"), name, name === "format_map" ? [dictionary()] : []); throw Error("expected missing key"); }
    catch (error) { expect(error).toBeInstanceOf(PythonKeyError); expect((error as PythonKeyError).args).toEqual([v.string("missing")]); }
  }
});
it("retains exact string identity for unchanged templates and single fields", () => {
  const { v, call } = fixture(), source = v.string("long template"), value = v.string("long field");
  expect(call(source, "format", [])).toBe(source);
  expect(call(v.string("{}"), "format", [value])).toBe(value);
  expect(call(v.string("{!s}"), "format", [value])).toBe(value);
});
it("retains a field after leading empty output but copies after trailing empty output", () => {
  const { v, call } = fixture(), value = v.string("long field value"), empty = v.string("");
  expect(call(v.string("{}{}"), "format", [empty, value])).toBe(value);
  expect(call(v.string("{}{}{}"), "format", [empty, empty, value])).toBe(value);
  expect(call(v.string("{0:.0}{1}"), "format", [v.string("discarded"), value])).toBe(value);
  expect(call(v.string("{}{}"), "format", [value, empty])).not.toBe(value);
  expect(call(v.string("{}{}{}"), "format", [empty, value, empty])).not.toBe(value);
});
it("preserves a nonempty guest str-subclass formatter result until a later append", () => {
  const { v, meter, dictionary } = fixture(), guest = v.cell({}), subclass = v.cell({}), storage = v.string("subclass text").value;
  const unused = (): never => { throw Error("unused lookup"); };
  const base = createRuntimeFormatContext(v, meter, { defaultRepr: unused });
  const context = { ...base, string: (value: RuntimeValue) => value === subclass ? storage : base.string(value), lookupFormat: (value: RuntimeValue) => value === guest ? () => subclass : base.lookupFormat(value) };
  const call = (source: string, args: readonly RuntimeValue[]) => createRuntimeBraceFormatMethod(v.string(source), "format", v, meter, context, { attribute: unused, getItem: unused }).value.invoke(args, dictionary(), meter);
  expect(call("{}", [guest])).toBe(subclass);
  expect(call("{}{}", [v.string(""), guest])).toBe(subclass);
  const copied = call("{}{}", [guest, v.string("")]);
  expect(copied).toEqual(v.string("subclass text"));
  expect(copied.kind).toBe("str");
});
