import {expect, it} from "vitest";
import reference from "./__snapshots__/base64-3.14.7.json";
import {BinasciiError, decodeBase64, encodeBase64} from "./base64.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";

const bytes = (hex: string): Uint8Array => Uint8Array.from({length: hex.length / 2}, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
const hex = (input: Uint8Array): string => [...input].map(byte => byte.toString(16).padStart(2, "0")).join("");

it("encodes every pinned Base64 vector with both newline policies", () => {
  expect(reference.oracle.unicode).toBe("16.0.0");
  for (const [input, newline, expected] of reference.encode) {
    expect(hex(encodeBase64(bytes(input as string), newline as boolean)), `${input}, newline=${newline}`).toBe(expected);
  }
});

it("matches pinned permissive and strict decoding, including padding error precedence", () => {
  for (const [input, strict, expected, message] of reference.decode) {
    let actual: {result: string} | {message: string};
    try {
      actual = {result: hex(decodeBase64(bytes(input as string), strict as boolean))};
    } catch (error) {
      if (!(error instanceof BinasciiError)) throw error;
      actual = {message: error.message};
    }
    expect(actual, `${input}, strict=${strict}`).toEqual(message === null ? {result: expected} : {message});
  }
});

it("returns independent storage without modifying either input", () => {
  const plain = Uint8Array.of(97), encoded = Uint8Array.of(89, 81, 61, 61);
  const encodedResult = encodeBase64(plain, false), decodedResult = decodeBase64(encoded);
  plain[0] = 98;
  encoded[0] = 90;
  expect([...encodedResult]).toEqual([89, 81, 61, 61]);
  expect([...decodedResult]).toEqual([97]);
  encodedResult.fill(0);
  decodedResult.fill(0);
  expect([...plain]).toEqual([98]);
  expect([...encoded]).toEqual([90, 81, 61, 61]);
});

it("defaults to one trailing newline on encoding and permissive decoding", () => {
  expect([...encodeBase64(new Uint8Array())]).toEqual([10]);
  expect(hex(encodeBase64(Uint8Array.of(97)))).toBe("59513d3d0a");
  expect(hex(decodeBase64(bytes("59513d3d59673d3d")))).toBe("610620");
});

it.each([encodeBase64, decodeBase64])("meters allocation and work before producing a result", transform => {
  expect(() => transform(new Uint8Array(1024), false, new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 0}))).toThrow(ExecutionLimitError);
  expect(() => transform(new Uint8Array(1024), false, new ExecutionBudget({maxSteps: 4, maxAllocatedBytes: 10000}))).toThrow(ExecutionLimitError);
});

it.each([encodeBase64, decodeBase64])("keeps cancellation fatal on empty input and during processing", transform => {
  for (const length of [0, 100]) {
    const controller = new AbortController();
    const budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal});
    let calls = 0;
    const meter: ExecutionMeter = {checkpoint(steps, allocation) {
      if (++calls === (length === 0 ? 1 : 3)) controller.abort();
      budget.checkpoint(steps, allocation);
    }};
    expect(() => transform(new Uint8Array(length), false, meter)).toThrow(ExecutionLimitError);
    expect(() => budget.checkpoint()).toThrow(ExecutionLimitError);
  }
});
