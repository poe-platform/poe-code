import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeUtf7, encodeUtf7} from "./utf7.js";

it.each(["encode", "decode"] as const)("bounds retained empty UTF-7 %s results", operation => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1024});
  const input = new CodePointString(new Uint32Array());
  const run = () => operation === "encode"
    ? encodeUtf7(input, meter)
    : decodeUtf7(new Uint8Array(), "strict", meter).text;
  const outputs = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) outputs.push(run());
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.length).toBeLessThan(100);
  expect(new Set(outputs).size).toBe(outputs.length);
  for (const output of outputs) expect([...output]).toEqual([]);
  let retry: unknown;
  try {run();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each(["encode", "decode"] as const)("admits the complete initial UTF-7 %s buffer atomically", operation => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: operation === "encode" ? 8 : 4});
  const input = new CodePointString(Uint32Array.of(65));
  expect(() => operation === "encode"
    ? encodeUtf7(input, meter)
    : decodeUtf7(Uint8Array.of(65), "strict", meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(0);
});

it("admits recovery buffer growth before copying or charging only its payload", () => {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 10000});
  const replacement = new CodePointString(Uint32Array.of(63, 63));
  let before = 0;
  expect(() => decodeUtf7(Uint8Array.of(255), () => {
    meter.checkpoint(0, 10000 - meter.usage.allocatedBytes - 64);
    before = meter.usage.allocatedBytes;
    return {replacement, input: Uint8Array.of(255), position: 1};
  }, meter)).toThrow(ExecutionLimitError);
  expect(before).toBeGreaterThan(0);
  expect(meter.usage.allocatedBytes).toBe(before);
});
