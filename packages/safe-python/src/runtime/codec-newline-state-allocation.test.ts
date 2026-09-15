import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {UniversalNewlineDecoder} from "./newline-decoder.js";

it.each([false, true])("bounds retained newline state snapshots with pending CR %s", pendingCR => {
  const decoder = new UniversalNewlineDecoder();
  decoder.setstate({pendingCR});
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1024});
  const states = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 100; index++) states.push(decoder.getstate(meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(states.length).toBeGreaterThan(0);
  expect(states.length).toBeLessThan(100);
  for (const state of states) {
    expect(state).toEqual({pendingCR});
    expect(Object.isFrozen(state)).toBe(true);
  }
  let retry: unknown;
  try {decoder.getstate(meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(decoder.getstate()).toEqual({pendingCR});
});

it("denies newline snapshot allocation without changing decoder state", () => {
  const decoder = new UniversalNewlineDecoder();
  decoder.setstate({pendingCR: true});
  const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 0});
  expect(() => decoder.getstate(meter)).toThrow(expect.objectContaining({reason: "allocation"}));
  expect(decoder.getstate()).toEqual({pendingCR: true});
  expect(decoder.newlines).toBeNull();
});
