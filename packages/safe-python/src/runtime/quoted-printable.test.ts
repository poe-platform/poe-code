import {expect, it} from "vitest";
import reference from "./__snapshots__/quoted-printable-3.14.7.json";
import {decodeQuotedPrintable, encodeQuotedPrintable} from "./quoted-printable.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";

const bytes = (hex: string): Uint8Array => Uint8Array.from({length: hex.length / 2}, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
const hex = (input: Uint8Array): string => [...input].map(byte => byte.toString(16).padStart(2, "0")).join("");

it("matches pinned quoted-printable wrapping, whitespace, newlines and all options", () => {
  expect(reference.oracle.unicode).toBe("16.0.0");
  for (const [input, quoteTabs, isText, header, expected] of reference.encode) {
    expect(hex(encodeQuotedPrintable(bytes(input as string), {quoteTabs: quoteTabs as boolean, isText: isText as boolean, header: header as boolean})), `${input}, ${quoteTabs}, ${isText}, ${header}`).toBe(expected);
  }
});

it("matches pinned permissive decoding for every escaped byte pair", () => {
  for (const [input, header, expected] of reference.decode) {
    expect(hex(decodeQuotedPrintable(bytes(input as string), header as boolean)), `${input}, ${header}`).toBe(expected);
  }
});

it("owns output storage without mutating or retaining the input", () => {
  const input = Uint8Array.of(65, 255), encoded = encodeQuotedPrintable(input), copy = encoded.slice();
  const decoded = decodeQuotedPrintable(encoded);
  expect(decoded).toEqual(input);
  decoded.fill(0);
  expect(encoded).toEqual(copy);
  encoded.fill(0);
  expect([...input]).toEqual([65, 255]);
});

it.each(["encode", "decode"] as const)("meters %s storage and work with terminal cancellation", operation => {
  const input = new Uint8Array(200).fill(operation === "encode" ? 255 : 65);
  const transform = (meter: ExecutionMeter) => operation === "encode" ? encodeQuotedPrintable(input, {}, meter) : decodeQuotedPrintable(input, false, meter);
  for (const limits of [{maxSteps: 10000, maxAllocatedBytes: 0}, {maxSteps: 3, maxAllocatedBytes: 10000}]) {
    expect(() => transform(new ExecutionBudget(limits))).toThrow(ExecutionLimitError);
  }
  for (const at of operation === "encode" ? [1, 3, 100, 250, 450] : [1, 3, 100]) {
    const controller = new AbortController();
    const budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal});
    let calls = 0;
    const meter: ExecutionMeter = {checkpoint(steps, allocation) {
      if (++calls === at) controller.abort();
      budget.checkpoint(steps, allocation);
    }};
    expect(() => transform(meter)).toThrow(ExecutionLimitError);
    expect(() => budget.checkpoint()).toThrow(ExecutionLimitError);
  }
});

it("meters long CR soft-break scans and shrinks decoder storage to its result", () => {
  const input = new Uint8Array(200).fill(65);
  input[0] = 61; input[1] = 13;
  expect(() => decodeQuotedPrintable(input, false, new ExecutionBudget({maxSteps: 20, maxAllocatedBytes: 10000}))).toThrow(ExecutionLimitError);
  const decoded = decodeQuotedPrintable(Uint8Array.of(61, 52, 49));
  expect([...decoded]).toEqual([65]);
  expect(decoded.buffer.byteLength).toBe(1);
});
