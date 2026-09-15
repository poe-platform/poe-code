import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeSingleByte} from "./single-byte-decode.js";

it.each(["ascii", "latin-1"] as const)("bounds retained empty %s decoder results", encoding => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const retained: ReturnType<typeof decodeSingleByte>[] = [];
  const run = () => decodeSingleByte(new Uint8Array(), encoding, "strict", meter);
  let failure: unknown;
  try {
    for (let index = 0; index < 20; index++) retained.push(run());
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.length).toBeLessThan(20);
  expect(new Set(retained).size).toBe(retained.length);
  expect(new Set(retained.map(result => result.text)).size).toBe(retained.length);
  for (const result of retained) expect([[...result.text], result.consumed]).toEqual([[], 0]);
  let retry: unknown;
  try {run();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each([0, 1])("admits ASCII result storage after recovery returns %i characters", length => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  const input = Uint8Array.of(255);
  const replacement = new CodePointString(new Uint32Array(length).fill(65));
  let calls = 0;
  const run = () => decodeSingleByte(input, "ascii", error => {
    calls++;
    // The remaining allowance covers character payloads, but cannot cover
    // the separately owned result record, point string and typed arrays.
    meter.checkpoint(0, 10000 - meter.usage.allocatedBytes - 64);
    return {replacement, input: error.object, position: error.end};
  }, meter);
  let failure: unknown;
  try {run();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(calls).toBe(1);
  expect([...input]).toEqual([255]);
  let retry: unknown;
  try {run();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(calls).toBe(1);
});
