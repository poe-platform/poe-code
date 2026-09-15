import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";
import {decodeQuotedPrintable, encodeQuotedPrintable} from "./quoted-printable.js";

it.each(["encode", "decode"] as const)("admits even empty quoted-printable %s storage", operation => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
  const input = new Uint8Array();
  expect(() => operation === "encode" ? encodeQuotedPrintable(input, {}, meter) : decodeQuotedPrintable(input, false, meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
});

it.each(["encode", "decode"] as const)("preserves cancellation identity at quoted-printable %s allocation", operation => {
  const failure = new ExecutionLimitError("cancelled");
  const meter: ExecutionMeter = {checkpoint(_steps, allocation = 0) {
    if (allocation > 0) throw failure;
  }};
  let actual: unknown;
  try {
    if (operation === "encode") encodeQuotedPrintable(new Uint8Array(), {}, meter);
    else decodeQuotedPrintable(new Uint8Array(), false, meter);
  } catch (error) {actual = error;}
  expect(actual).toBe(failure);
});

it.each([Uint8Array.of(61), Uint8Array.of(61, 52, 49)])("admits the decoder's separately owned shortened result for %j", input => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 64 + input.length});
  expect(() => decodeQuotedPrintable(input, false, meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(64 + input.length);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
});
