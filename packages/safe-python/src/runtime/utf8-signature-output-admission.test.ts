import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeUtf8Signature, Utf8SignatureDecoder} from "./utf8-signature.js";

it.each([[], [239], [239, 187]].map(input => ({input})))("admits ambiguous BOM result storage before buffering $input", ({input}) => {
  const decoder = new Utf8SignatureDecoder();
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 100});
  let failure: unknown;
  try {decoder.decode(Uint8Array.from(input), true, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(decoder.getstate()).toEqual([new Uint8Array(), 1n]);
  expect(() => decoder.decode(new Uint8Array(), false, meter)).toThrow(failure as Error);
});

it("admits the stateless BOM input view before decoding", () => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 63});
  expect(() => decodeUtf8Signature(Uint8Array.of(239, 187, 191), "strict", meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
});

it("admits the signature-adjusted result record before returning", () => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 320});
  expect(() => decodeUtf8Signature(Uint8Array.of(239, 187, 191), "strict", meter)).toThrow(ExecutionLimitError);
});

it("retains BOM recognition but not pending input when decode storage admission fails", () => {
  const decoder = new Utf8SignatureDecoder();
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 64});
  expect(() => decoder.decode(Uint8Array.of(239, 187, 191), true, meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(64);
  expect(decoder.getstate()).toEqual([new Uint8Array(), 0n]);
});
