import { expect, it } from "vitest";
import { createOrdBuiltin } from "./builtin-ord.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { constructRuntimeDictionary } from "./runtime-dictionary-update.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 1000000 }), v = new RuntimeValues(meter);
  const keywords = constructRuntimeDictionary([], new Map(), v, { hash: () => 1n, equal: (a, b) => a === b }, meter);
  const builtin = createOrdBuiltin(v, meter);
  return { v, meter, keywords, builtin, call: (value: RuntimeValue) => builtin.value.invoke([value], keywords, meter) };
}
it("reads one Unicode code point or byte without UTF-16 truncation", () => {
  const { v, call } = fixture();
  for (const point of [0, 65, 255, 256, 0xd800, 0xdc00, 0x1f600, 0x10ffff]) expect(call(v.stringPoints(Uint32Array.of(point)))).toEqual(v.integer(point));
  for (let byte = 0; byte < 256; byte++) expect(call(v.bytes(Uint8Array.of(byte)))).toEqual(v.integer(byte));
});
it("reports code-point or byte lengths and rejects unrelated values", () => {
  const { v, call } = fixture();
  for (const value of [v.string(""), v.bytes(new Uint8Array(0))]) expect(() => call(value)).toThrow("ord() expected a character, but string of length 0 found");
  for (const value of [v.string("😀a"), v.stringPoints(Uint32Array.of(0xd800, 0xdc00)), v.bytes(Uint8Array.of(1, 2))]) expect(() => call(value)).toThrow("ord() expected a character, but string of length 2 found");
  expect(() => call(v.integer(65))).toThrow("ord() expected string of length 1, but int found");
  expect(() => call(v.none)).toThrow("ord() expected string of length 1, but NoneType found");
});
it("validates keywords and arity before inspecting payloads", () => {
  const { v, meter, keywords, builtin } = fixture();
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("ord() takes exactly one argument (0 given)");
  expect(() => builtin.value.invoke([v.none, v.none], keywords, meter)).toThrow("ord() takes exactly one argument (2 given)");
  keywords.items.set(v.string("c"), v.string("a"));
  expect(() => builtin.value.invoke([], keywords, meter)).toThrow("ord() takes no keyword arguments");
});
it("accepts explicit subclass and bytearray storage without conversion or a full copy", () => {
  const { v, meter, keywords } = fixture(), subclass = v.cell({}), array = v.cell({});
  let length = 1, reads = 0;
  const builtin = createOrdBuiltin(v, meter, {
    string: value => value === subclass ? v.string("😀").value : undefined,
    bytes: value => value === array ? { length, byteAt(index) { expect(index).toBe(0n); reads++; return 233; } } : undefined
  });
  expect(builtin.value.invoke([subclass], keywords, meter)).toEqual(v.integer(0x1f600));
  expect(builtin.value.invoke([array], keywords, meter)).toEqual(v.integer(233));
  length = 1000000;
  expect(() => builtin.value.invoke([array], keywords, meter)).toThrow("string of length 1000000 found");
  expect(reads).toBe(1);
});
it("bounds unsupported type names and checks cancellation after storage inspection", () => {
  const { v, meter, keywords } = fixture(), guest = v.cell({});
  const builtin = createOrdBuiltin(v, meter, { typeName: () => "é".repeat(300) });
  expect(() => builtin.value.invoke([guest], keywords, meter)).toThrow(`ord() expected string of length 1, but ${"é".repeat(100)} found`);
  const controller = new AbortController(), limited = new ExecutionBudget({ maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal });
  const storage = v.string("a").value;
  const cancelled = createOrdBuiltin(v, limited, { string() { controller.abort(); return storage; } });
  expect(() => cancelled.value.invoke([guest], keywords, limited)).toThrow(ExecutionLimitError);
});
