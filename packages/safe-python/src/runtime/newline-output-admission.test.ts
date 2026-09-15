import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {UniversalNewlineDecoder} from "./newline-decoder.js";

it.each([false, true])("admits newline work-buffer metadata before allocation (translate=%s)", translate => {
  const decoder = new UniversalNewlineDecoder(translate);
  decoder.decode(new CodePointString(Uint32Array.of(10, 13)));
  const before = decoder.getstate(), seen = decoder.newlines;
  const input = new CodePointString(Uint32Array.of(10, 65));
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 12});
  let failure: unknown;
  try {decoder.decode(input, true, meter);} catch (error) {failure = error;}
  expect(failure).toMatchObject({reason: "allocation"});
  expect(meter.usage.allocatedBytes).toBe(0);
  expect(decoder.getstate()).toEqual(before);
  expect(decoder.newlines).toEqual(seen);
  let retry: unknown;
  try {decoder.decode(input, true, meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each([false, true])("bounds retained empty newline results (translate=%s)", translate => {
  const decoder = new UniversalNewlineDecoder(translate);
  const input = new CodePointString(Uint32Array.of(13));
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const outputs: CodePointString[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) {
      decoder.reset();
      outputs.push(decoder.decode(input, false, meter));
    }
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.length).toBeLessThan(100);
  expect(new Set(outputs).size).toBe(outputs.length);
  for (const output of outputs) expect([...output]).toEqual([]);
});

it("admits newline result metadata before committing pending CR and history", () => {
  const decoder = new UniversalNewlineDecoder();
  decoder.decode(new CodePointString(Uint32Array.of(10, 13)));
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 76});
  expect(() => decoder.decode(new CodePointString(Uint32Array.of(10, 65)), true, meter)).toThrow(ExecutionLimitError);
  expect(decoder.getstate()).toEqual({pendingCR: true});
  expect(decoder.newlines).toBe("\n");
});
