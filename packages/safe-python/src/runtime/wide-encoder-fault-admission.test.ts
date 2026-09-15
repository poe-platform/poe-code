import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {WideUnicodeEncoder} from "./utf-wide-incremental.js";

const variants = ([16, 32] as const).flatMap(width => ([-1, 0, 1] as const).flatMap(byteorder =>
  (["strict", "surrogateescape", "callback"] as const).map(policy => ({width, byteorder, policy}))));

it.each(variants)("admits UTF-$width encoder faults before $policy recovery (order=$byteorder)", ({width, byteorder, policy}) => {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  const input = CodePointString.fromString("\ud800", setup);
  // Both widths can allocate their scratch/growth buffers with this allowance,
  // but cannot additionally own a UnicodeEncodeError and its diagnostic.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 300});
  let calls = 0;
  const encoder = new WideUnicodeEncoder(width, byteorder, policy === "callback" ? () => {
    calls++;
    throw new Error("recovery entered without admitted fault storage");
  } : policy);
  let failure: unknown;
  try {encoder.encode(input, true, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(calls).toBe(0);
  expect(encoder.getstate()).toBe(byteorder === 0 ? 2n : 0n);
  for (const operation of [
    () => encoder.getstate(meter),
    () => encoder.reset(meter),
    () => encoder.encode(input, true, meter)
  ]) {
    let retry: unknown;
    try {operation();} catch (error) {retry = error;}
    expect(retry).toBe(failure);
  }
});
