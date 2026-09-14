import {expect, it} from "vitest";
import reference from "./__snapshots__/hexadecimal-3.14.7.json";
import {decodeHexadecimal, encodeHexadecimal} from "./hexadecimal.js";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";

const bytes = (hex: string): Uint8Array => Uint8Array.from({length: hex.length / 2}, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
const hex = (input: Uint8Array): string => [...input].map(byte => byte.toString(16).padStart(2, "0")).join("");

it("matches pinned hexadecimal encoding with signed grouping and every separator byte domain", () => {
  expect(reference.oracle.unicode).toBe("16.0.0");
  for (const [input, separator, group, expected] of reference.encode) {
    expect(hex(encodeHexadecimal(bytes(input as string), separator === null ? undefined : separator as number, group as number)), `${input}, sep=${separator}, group=${group}`).toBe(expected);
  }
});

it("matches pinned hexadecimal decoding and odd-length error precedence", () => {
  for (const [input, expected, message] of reference.decode) {
    let actual: {result: string} | {message: string};
    try { actual = {result: hex(decodeHexadecimal(bytes(input!)))}; }
    catch (error) {
      if (!(error instanceof BinasciiError)) throw error;
      actual = {message: error.message};
    }
    expect(actual, input!).toEqual(message === null ? {result: expected} : {message});
  }
});

it("returns independent buffers and preserves source storage", () => {
  const plain = Uint8Array.of(0, 255), encoded = Uint8Array.of(48, 48, 102, 102);
  const first = encodeHexadecimal(plain), second = decodeHexadecimal(encoded);
  expect([...first]).toEqual([...encoded]);
  expect([...second]).toEqual([...plain]);
  first.fill(1); second.fill(2);
  expect([...plain]).toEqual([0, 255]);
  expect([...encoded]).toEqual([48, 48, 102, 102]);
});

it.each(["encode", "decode"] as const)("meters %s allocation and processing and latches cancellation", operation => {
  const input = new Uint8Array(128).fill(48);
  const transform = (input: Uint8Array, meter: ExecutionMeter) => operation === "encode" ? encodeHexadecimal(input, 58, 1, meter) : decodeHexadecimal(input, meter);
  for (const limits of [{maxSteps: 10000, maxAllocatedBytes: 0}, {maxSteps: 3, maxAllocatedBytes: 10000}]) {
    expect(() => transform(input, new ExecutionBudget(limits))).toThrow(ExecutionLimitError);
  }
  for (const size of [0, 128]) {
    const controller = new AbortController();
    const budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal});
    let calls = 0;
    const meter: ExecutionMeter = {checkpoint(steps, allocation) {
      if (++calls === (size === 0 ? 1 : 3)) controller.abort();
      budget.checkpoint(steps, allocation);
    }};
    expect(() => transform(input.subarray(0, size), meter)).toThrow(ExecutionLimitError);
    expect(() => budget.checkpoint()).toThrow(ExecutionLimitError);
  }
});

it("observes fatal cancellation before malformed-input diagnostics", () => {
  const controller = new AbortController(); controller.abort();
  for (const input of [Uint8Array.of(120), Uint8Array.of(120, 120)]) {
    expect(() => decodeHexadecimal(input, new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal}))).toThrow(ExecutionLimitError);
  }
});
