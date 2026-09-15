import {expect, it} from "vitest";
import reference from "./__snapshots__/uuencode-3.14.7.json";
import {decodeUu, encodeUu} from "./uuencode.js";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";

const bytes = (hex: string): Uint8Array => Uint8Array.from({length: hex.length / 2}, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
const hex = (input: Uint8Array): string => [...input].map(byte => byte.toString(16).padStart(2, "0")).join("");

it("matches pinned uuencode lengths, byte domains, padding and backticks", () => {
  expect(reference.oracle.unicode).toBe("16.0.0");
  for (const [input, backtick, expected, message] of reference.encode) {
    let actual: [string | null, string | null];
    try { actual = [hex(encodeUu(bytes(input as string), backtick as boolean)), null]; }
    catch (error) { if (!(error instanceof BinasciiError)) throw error; actual = [null, error.message]; }
    expect(actual, `${input}, backtick=${backtick}`).toEqual([expected, message]);
  }
});

it("matches pinned length-byte masking, truncation, illegal bytes and trailing garbage", () => {
  for (const [input, expected, message] of reference.decode) {
    let actual: [string | null, string | null];
    try { actual = [hex(decodeUu(bytes(input!))), null]; }
    catch (error) { if (!(error instanceof BinasciiError)) throw error; actual = [null, error.message]; }
    expect(actual, input!).toEqual([expected, message]);
  }
});

it("owns results independently without changing the input", () => {
  const input = Uint8Array.of(0, 255), encoded = encodeUu(input), copy = encoded.slice();
  const decoded = decodeUu(encoded);
  expect([...decoded]).toEqual([0, 255]);
  decoded.fill(1);
  expect(encoded).toEqual(copy);
  encoded.fill(2);
  expect([...input]).toEqual([0, 255]);
});

it.each(["encode", "decode"] as const)("meters %s allocation and work and preserves fatal cancellation", operation => {
  const input = operation === "encode" ? new Uint8Array(45) : encodeUu(new Uint8Array(45));
  const transform = (data: Uint8Array, meter: ExecutionMeter) => operation === "encode" ? encodeUu(data, false, meter) : decodeUu(data, meter);
  for (const limits of [{maxSteps: 10000, maxAllocatedBytes: 0}, {maxSteps: 3, maxAllocatedBytes: 10000}]) {
    expect(() => transform(input, new ExecutionBudget(limits))).toThrow(ExecutionLimitError);
  }
  for (const at of [1, 3]) {
    const controller = new AbortController();
    const budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal});
    let calls = 0;
    const meter: ExecutionMeter = {checkpoint(steps, allocation) {
      if (++calls === at) controller.abort();
      budget.checkpoint(steps, allocation);
    }};
    expect(() => transform(input, meter)).toThrow(ExecutionLimitError);
    expect(() => budget.checkpoint()).toThrow(ExecutionLimitError);
  }
});

it("checks cancellation before malformed-input errors", () => {
  const controller = new AbortController(); controller.abort();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal});
  expect(() => decodeUu(new Uint8Array(), meter)).toThrow(ExecutionLimitError);
  expect(() => encodeUu(new Uint8Array(46), false, meter)).toThrow(ExecutionLimitError);
});
