import { expect, it } from "vitest";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture(input: number[]) {
  const meter = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter), value = v.bytes(Uint8Array.from(input));
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (name: string, args: RuntimeValue[] = [], callMeter = meter) => {
    const method = runtimeNativeAttribute(value, name, v, callMeter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, callMeter);
  };
  return { v, value, keywords, call };
}

it.each([
  ["isascii", [0, 65, 127], [128]], ["isspace", [9, 10, 11, 12, 13, 32], [32, 28]],
  ["isalpha", [65, 90, 97, 122], [97, 0xe9]], ["isalnum", [65, 97, 48, 57], [97, 95]],
  ["isdigit", [48, 57], [0xb2]], ["islower", [97, 0xff, 48], [97, 65]],
  ["isupper", [65, 0xff, 48], [65, 97]], ["istitle", [65, 98, 0xff, 67, 100], [65, 98, 0xff, 99]]
] as const)("implements ASCII bytes.%s", (name, yes, no) => {
  const valid = fixture([...yes]), invalid = fixture([...no]), empty = fixture([]);
  expect(valid.call(name)).toBe(valid.v.true); expect(invalid.call(name)).toBe(invalid.v.false);
  expect(empty.call(name)).toBe(empty.v.boolean(name === "isascii"));
});

it.each(["isascii", "isspace", "isalpha", "isalnum", "isdigit", "islower", "isupper", "istitle"])("rejects arguments and keywords for bytes.%s", name => {
  const { call, v, keywords } = fixture([]);
  expect(() => call(name, [v.true])).toThrow(`bytes.${name}() takes no arguments (1 given)`);
  keywords.items.set(v.string("x"), v.true);
  expect(() => call(name)).toThrow(`bytes.${name}() takes no keyword arguments`);
});

it("requires a cased ASCII byte for case predicates", () => {
  const { call, v } = fixture([0, 48, 128, 0xe9, 0xff]);
  for (const name of ["islower", "isupper", "istitle"]) expect(call(name)).toBe(v.false);
});

it("does not expose Unicode-only string predicates on bytes", () => {
  const { call } = fixture([]);
  for (const name of ["isidentifier", "isdecimal", "isnumeric", "isprintable"]) expect(() => call(name)).toThrow(`'bytes' object has no attribute '${name}'`);
});

it("short-circuits invalid input without copying the bytes", () => {
  const { call, v } = fixture([255, ...Array<number>(2000).fill(97)]);
  const meter = new ExecutionBudget({ maxSteps: 4, maxAllocatedBytes: 64 });
  expect(call("isalpha", [], meter)).toBe(v.false);
  expect(meter.usage.allocatedBytes).toBe(64);
});

it("meters long uncased scans as well as successful scans", () => {
  for (const [name, byte] of [["isascii", 97], ["islower", 0xff], ["istitle", 0xff]] as const) {
    const { call } = fixture(Array<number>(2000).fill(byte));
    expect(() => call(name, [], new ExecutionBudget({ maxSteps: 50, maxAllocatedBytes: 64 }))).toThrow(ExecutionLimitError);
  }
});
