import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {encodeSingleByte} from "./single-byte-encode.js";

it.each(["ascii", "latin-1"] as const)("bounds retained empty %s encoding results", encoding => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 320});
  const input = new CodePointString(new Uint32Array());
  const retained: Uint8Array[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 10; index++) retained.push(encodeSingleByte(input, encoding, "strict", meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(retained.length).toBeLessThanOrEqual(5);
  expect(new Set(retained).size).toBe(retained.length);
  expect(retained.every(value => value.length === 0)).toBe(true);
  expect(() => encodeSingleByte(input, encoding, "strict", meter)).toThrow(failure as Error);
});

it.each(["ascii", "latin-1"] as const)("admits %s result metadata after recovery consumes the budget", encoding => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000});
  const input = new CodePointString(Uint32Array.of(0x100));
  let calls = 0;
  expect(() => encodeSingleByte(input, encoding, error => {
    calls++;
    // Leave room for the output payload, but not its owned typed-array header.
    meter.checkpoint(0, 1000 - meter.usage.allocatedBytes - 63);
    return {replacement: Uint8Array.of(65), position: error.end};
  }, meter)).toThrow(ExecutionLimitError);
  expect(calls).toBe(1);
});
