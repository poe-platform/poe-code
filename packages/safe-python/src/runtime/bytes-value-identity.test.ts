import { expect, it } from "vitest";
import { parseExpression } from "../expression.js";
import { constantSlice } from "./constant-slice.js";
import { constantRepeat } from "./constant-repeat.js";
import { constantConcat } from "./constant-concat.js";
import { ExecutionBudget, ExecutionLimitError } from "./execution-budget.js";
import { OrderedKeyMap } from "./ordered-key-map.js";
import { runtimeIndex } from "./runtime-index.js";
import { runtimeNativeAttribute } from "./runtime-native-attribute.js";
import { RuntimeValues, type RuntimeValue } from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({ maxSteps: 100000, maxAllocatedBytes: 100000 }), v = new RuntimeValues(meter);
  const keywords = v.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({ hash: () => 1n, equal: (a, b) => a === b }, meter));
  const call = (receiver: RuntimeValue, name: string, args: RuntimeValue[] = []) => {
    const method = runtimeNativeAttribute(receiver, name, v, meter);
    if (method.kind !== "builtin_function_or_method") throw new Error("expected method");
    return method.value.invoke(args, keywords, meter);
  };
  return { meter, v, call };
}

it("canonicalizes every single-byte value from mutable or owned input", () => {
  const { v, meter } = fixture();
  for (let byte = 0; byte < 256; byte++) {
    const input = Uint8Array.of(byte), first = v.bytes(input); input[0] ^= 255;
    const before = meter.usage.allocatedBytes;
    expect(v.bytes(Uint8Array.of(byte))).toBe(first);
    expect(v.bytes(first.value)).toBe(first);
    expect(meter.usage.allocatedBytes).toBe(before);
    expect([...first.value]).toEqual([byte]);
  }
});

it("keeps explicit fresh one-byte values out of the canonical cache", () => {
  const { v } = fixture(), fresh = v.bytes(Uint8Array.of(65), "fresh"), canonical = v.bytes(Uint8Array.of(65));
  expect(fresh === canonical).toBe(false);
  expect(v.bytes(fresh.value)).toBe(canonical);
  expect(v.bytes(canonical.value, "fresh") === canonical).toBe(false);
  const empty = v.bytes(new Uint8Array()), freshEmpty = v.bytes(new Uint8Array(), "fresh");
  expect(freshEmpty === empty).toBe(false); expect(v.bytes(freshEmpty.value)).toBe(empty);
  expect(v.bytes(Uint8Array.of(1, 2)) === v.bytes(Uint8Array.of(1, 2))).toBe(false);
});

it("canonicalizes independent parsed small literals within the runtime", () => {
  const { v } = fixture();
  for (const source of ['b""', 'b"A"', 'b"\\xff"']) {
    const first = parseExpression(source), second = parseExpression(source);
    if (first.kind !== "literal" || second.kind !== "literal") throw new Error("expected literal");
    expect(v.literal(first)).toBe(v.literal(second));
  }
  expect(v.bytes(Uint8Array.of(65)) === fixture().v.bytes(Uint8Array.of(65))).toBe(false);
});

it("charges lazy cache storage once and permits allocation-free hits", () => {
  const meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 289 }), v = new RuntimeValues(meter);
  const value = v.bytes(Uint8Array.of(65));
  expect(meter.usage.allocatedBytes).toBe(289);
  expect(v.bytes(Uint8Array.of(65))).toBe(value);
  expect(() => v.bytes(Uint8Array.of(66))).toThrow(ExecutionLimitError);
});

it("honors cancellation on cached reads", () => {
  const controller = new AbortController(), meter = new ExecutionBudget({ maxSteps: 100, maxAllocatedBytes: 1000, signal: controller.signal }), v = new RuntimeValues(meter);
  v.bytes(new Uint8Array()); controller.abort();
  expect(() => v.bytes(new Uint8Array())).toThrow(ExecutionLimitError);
});

it("canonicalizes contiguous slices but not one-byte strided results", () => {
  const { v, meter, call } = fixture(), canonical = v.bytes(Uint8Array.of(65)), source = v.bytes(Uint8Array.of(90, 65));
  expect(constantSlice(source, { lower: v.integer(1) }, v, meter)).toBe(canonical);
  expect(runtimeIndex(source, v.slice({ lower: v.integer(1) }), v, meter)).toBe(canonical);
  for (const step of [-1, 2]) {
    const result = constantSlice(canonical, { step: v.integer(step) }, v, meter);
    expect(result === canonical).toBe(false);
    expect(runtimeIndex(canonical, v.slice({ step: v.integer(step) }), v, meter) === canonical).toBe(false);
  }
  const fresh = call(v.bytes(Uint8Array.of(97)), "upper");
  expect(fresh === canonical).toBe(false);
  expect(constantSlice(fresh, {}, v, meter)).toBe(fresh);
  expect(runtimeIndex(fresh, v.slice({}), v, meter)).toBe(fresh);
  expect(constantSlice(source, { lower: v.integer(1), upper: v.integer(1), step: v.integer(2) }, v, meter)).toBe(v.bytes(new Uint8Array()));
});

it("reuses canonical partition sides and removal results while retaining a fresh separator", () => {
  const { v, call } = fixture(), sep = v.bytes(Uint8Array.of(65)), source = v.bytes(Uint8Array.of(65, 65));
  const result = call(source, "partition", [sep]);
  if (result.kind !== "tuple") throw new Error("expected tuple");
  expect(result.items[0]).toBe(v.bytes(new Uint8Array())); expect(result.items[2]).toBe(sep);
  expect(call(source, "removeprefix", [sep])).toBe(sep);
  expect(call(source, "removesuffix", [source])).toBe(v.bytes(new Uint8Array()));
  const freshSep = call(v.bytes(Uint8Array.of(97)), "upper"), freshResult = call(source, "partition", [freshSep]);
  if (freshResult.kind !== "tuple") throw new Error("expected tuple");
  expect(freshResult.items[1]).toBe(freshSep); expect(freshResult.items[2]).toBe(sep);
});

it("preserves fresh zero-repeat empties only where CPython preserves them", () => {
  const { v, meter, call } = fixture(), source = v.bytes(Uint8Array.of(65)), empty = v.bytes(new Uint8Array());
  const fresh = constantRepeat(source, v.integer(0), v, meter);
  expect(fresh === empty).toBe(false);
  expect(constantRepeat(source, v.integer(-1), v, meter) === fresh).toBe(false);
  expect(constantRepeat(fresh, v.integer(0), v, meter)).toBe(fresh);
  expect(constantSlice(fresh, {}, v, meter)).toBe(empty);
  expect(runtimeIndex(fresh, v.slice({}), v, meter)).toBe(empty);
  expect(constantSlice(fresh, { step: v.integer(2) }, v, meter)).toBe(empty);
  expect(constantConcat(fresh, empty, v, meter)).toBe(empty);
  expect(constantConcat(empty, fresh, v, meter)).toBe(fresh);
  for (const name of ["upper", "lower", "title", "capitalize", "swapcase"]) expect(call(fresh, name)).toBe(empty);
  expect(call(fresh, "removeprefix", [source])).toBe(fresh);
  const result = call(fresh, "partition", [source]);
  if (result.kind !== "tuple") throw new Error("expected tuple");
  expect(result.items[0]).toBe(fresh); expect(result.items[1]).toBe(empty); expect(result.items[2]).toBe(empty);
});
