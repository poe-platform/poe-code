import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeUnicodeEscape, UnicodeEscapeDecoder} from "./unicode-escape.js";

it.each([false, true])("bounds retained empty escape decoder results (raw=%s)", raw => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const outputs = [];
  const input = new Uint8Array();
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) {
      outputs.push(decodeUnicodeEscape(input, raw, "strict", meter, true, () => {}));
    }
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.length).toBeLessThan(100);
  expect(new Set(outputs).size).toBe(outputs.length);
  expect(new Set(outputs.map(output => output.text)).size).toBe(outputs.length);
  for (const output of outputs) expect([[...output.text], output.consumed]).toEqual([[], 0]);
  let retry: unknown;
  try {decodeUnicodeEscape(input, raw, "strict", meter, true, () => {});} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each([false, true])("admits the complete initial escape decoding buffer (raw=%s)", raw => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 4});
  expect(() => decodeUnicodeEscape(Uint8Array.of(65), raw, "strict", meter, true, () => {})).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
});

it.each([false, true])("admits escape recovery growth before charging only its payload (raw=%s)", raw => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  const input = Uint8Array.of(92, 117);
  const replacement = new CodePointString(Uint32Array.of(65, 66, 67));
  let before = 0;
  expect(() => decodeUnicodeEscape(input, raw, () => {
    meter.checkpoint(0, 10000 - meter.usage.allocatedBytes - 64);
    before = meter.usage.allocatedBytes;
    return {replacement, position: 2, input};
  }, meter, true, () => {})).toThrow(ExecutionLimitError);
  expect(before).toBeGreaterThan(0);
  expect(meter.usage.allocatedBytes).toBe(before);
});

it.each([false, true])("admits joined escape input before allocation and preserves pending state (raw=%s)", raw => {
  const decoder = new UnicodeEscapeDecoder(raw, "strict", () => {});
  decoder.setstate([Uint8Array.of(92), 0n]);
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 6});
  expect(() => decoder.decode(Uint8Array.of(117, 48, 48, 52, 49), true, meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(decoder.getstate()).toEqual([Uint8Array.of(92), 0n]);
  expect([...decoder.decode(Uint8Array.of(117, 48, 48, 52, 49), true)]).toEqual([65]);
});
