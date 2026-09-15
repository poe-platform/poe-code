import { expect, it } from "vitest";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget } from "./execution-budget.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const call = (source: RuntimeValue, name: string, args: readonly RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(source, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw Error("expected bound method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, call };
}
it("canonicalizes strip and prefix/suffix removal substrings", () => {
  const { v, call } = fixture();
  for (const text of ["a", "é", "ÿ"]) {
    const char = v.string(text);
    expect(call(v.string(" " + text + " "), "strip")).toBe(char);
    expect(call(v.string("!" + text), "lstrip", [v.string("!")])).toBe(char);
    expect(call(v.string(text + "!"), "rstrip", [v.string("!")])).toBe(char);
    expect(call(v.string("!" + text), "removeprefix", [v.string("!")])).toBe(char);
    expect(call(v.string(text + "!"), "removesuffix", [v.string("!")])).toBe(char);
  }
});
it("canonicalizes partition members while preserving separator identity", () => {
  const { v, call } = fixture(), char = v.string("é"), separator = v.stringPoints(v.string("!").value, "fresh");
  for (const name of ["partition", "rpartition"]) {
    const result = call(v.string("é!é"), name, [separator]);
    if (result.kind !== "tuple") throw Error("expected tuple");
    expect(result.items[0]).toBe(char); expect(result.items[1]).toBe(separator); expect(result.items[2]).toBe(char);
  }
});
it("canonicalizes split and splitlines members", () => {
  const { v, call } = fixture(), char = v.string("é");
  for (const [source, name, args] of [
    ["é!é", "split", [v.string("!")]], ["é!é", "rsplit", [v.string("!")]],
    [" é é ", "split", []], [" é é ", "rsplit", []], ["é\né", "splitlines", []]
  ] as const) {
    const result = call(v.string(source), name, args);
    if (result.kind !== "list") throw Error("expected list");
    expect(result.items.get(0n)).toBe(char); expect(result.items.get(1n)).toBe(char);
  }
});
it("copies zero-limit whitespace remainders into canonical characters but preserves unsplit sources", () => {
  const { v, call } = fixture(), char = v.string("é"), fresh = v.stringPoints(char.value, "fresh");
  for (const name of ["split", "rsplit"]) for (const limit of [-1, 0, 1]) {
    const result = call(fresh, name, [v.none, v.integer(limit)]);
    if (result.kind !== "list") throw Error("expected list");
    expect(result.items.get(0n)).toBe(limit === 0 ? char : fresh);
  }
  expect(call(fresh, "strip")).toBe(fresh);
  expect(call(fresh, "removeprefix", [v.string("missing")])).toBe(fresh);
});
