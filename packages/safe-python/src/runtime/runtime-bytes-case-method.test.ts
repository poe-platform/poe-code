import { expect, it } from "vitest";
import { ExecutionBudget } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input: number[], name: string) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input));
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(value, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { v, value, keywords, call };
}

it.each([
  ["upper", "THEY'RE A1BC"], ["lower", "they're a1bc"], ["title", "They'Re A1Bc"],
  ["capitalize", "They're a1bc"], ["swapcase", "tHEY'RE a1bC"]
])("implements ASCII-only bytes.%s", (name, expected) => {
  const input = [..."They're A1Bc"].map(c => c.charCodeAt(0));
  const { call } = fixture([...input, 0xdf, 0xff, 0], name), result = call();
  if (result.kind !== "bytes") throw new Error("expected bytes");
  expect([...result.value]).toEqual([...expected].map(c => c.charCodeAt(0)).concat([0xdf, 0xff, 0]));
});

it.each(["upper", "lower", "title", "capitalize", "swapcase"])("retains only empty receiver identity for bytes.%s", name => {
  const empty = fixture([], name); expect(empty.call()).toBe(empty.value);
  const unchanged = fixture([49, 0xff, 0], name), result = unchanged.call();
  expect(result === unchanged.value).toBe(false);
  if (result.kind !== "bytes") throw new Error("expected bytes");
  expect([...result.value]).toEqual([49, 0xff, 0]);
});

it.each(["upper", "lower", "title", "capitalize", "swapcase"])("rejects arguments and keywords for bytes.%s", name => {
  const { call, v, keywords } = fixture([], name);
  expect(() => call([v.true])).toThrow(`bytes.${name}() takes no arguments (1 given)`);
  keywords.items.set(v.string("x"), v.true);
  expect(() => call()).toThrow(`bytes.${name}() takes no keyword arguments`);
});
