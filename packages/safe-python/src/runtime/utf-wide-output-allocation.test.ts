import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {WideUnicodeEncoder} from "./utf-wide-incremental.js";
import {encodeWideUnicode} from "./utf-wide.js";

const encoders = ([16, 32] as const).flatMap(width => ([-1, 0, 1] as const).flatMap(order =>
  [false, true].map(incremental => ({width, order, incremental}))));

it.each(encoders)("bounds retained empty UTF-$width outputs (order=$order, incremental=$incremental)", ({width, order, incremental}) => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 100000});
  const input = CodePointString.fromString("", meter);
  const encoder = new WideUnicodeEncoder(width, order);
  encoder.encode(input, false, meter);
  const encode = () => incremental ? encoder.encode(input, false, meter) : encodeWideUnicode(input, width, order, "strict", meter);
  meter.checkpoint(0, 100000 - meter.usage.allocatedBytes - 1024);
  const outputs: Uint8Array[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) outputs.push(encode());
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.length).toBeLessThan(100);
  expect(new Set(outputs).size).toBe(outputs.length);
  const expected = !incremental && order === 0 ? width === 16 ? [255, 254] : [255, 254, 0, 0] : [];
  for (const output of outputs) expect([...output]).toEqual(expected);
  expect(() => encode()).toThrow(failure);
});

it.each([16, 32] as const)("retains UTF-%s BOM state when final output allocation fails", width => {
  const input = new CodePointString(Uint32Array.of(65));
  const reference = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 100000});
  new WideUnicodeEncoder(width).encode(input, false, reference);
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: reference.usage.allocatedBytes - 1});
  const encoder = new WideUnicodeEncoder(width);
  expect(() => encoder.encode(input, false, meter)).toThrow(ExecutionLimitError);
  expect(encoder.getstate()).toBe(2n);
  expect([...encoder.encode(input)]).toEqual(width === 16 ? [255, 254, 65, 0] : [255, 254, 0, 0, 65, 0, 0, 0]);
});

it.each([16, 32] as const)("owns UTF-%s recovery output across growth and cancellation", width => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 100000, signal: controller.signal});
  const input = CodePointString.fromString("\ud800", meter);
  const replacement = new Uint8Array(128).fill(65);
  let calls = 0;
  const recover = () => {calls++; return {replacement, position: 1};};
  const encoder = new WideUnicodeEncoder(width, 0, recover);
  const first = encoder.encode(input, false, meter);
  const second = encoder.encode(input, false, meter);
  first.fill(0);
  replacement.fill(0);
  expect([...second]).toEqual(new Array<number>(128).fill(65));
  expect(encoder.getstate()).toBe(0n);
  controller.abort();
  expect(() => encoder.encode(input, false, meter)).toThrow(ExecutionLimitError);
  expect(calls).toBe(2);
  expect(encoder.getstate()).toBe(0n);
});
