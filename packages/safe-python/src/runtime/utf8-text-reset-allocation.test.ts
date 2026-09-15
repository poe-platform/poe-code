import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {Utf8TextDecoder} from "./utf8-text-decoder.js";

it.each([null, "", "\n", "\r", "\r\n"])("admits reset state before discarding buffered text for %j", newline => {
  const decoder = new Utf8TextDecoder(newline);
  decoder.decode(Uint8Array.of(10, 13, 0xe2));
  const observed = decoder.newlines;
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
  let failure: unknown;
  try {decoder.reset(meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(decoder.newlines).toEqual(observed);
  let retry: unknown;
  try {decoder.reset(meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  // A fresh meter inspects the kernel's uncommitted state; the failed meter
  // remains terminal. Both the pending CR and multibyte prefix must survive.
  expect([...decoder.decode(Uint8Array.of(0x82, 0xac), true)])
    .toEqual(newline === null ? [10, 0x20ac] : newline === "" ? [13, 0x20ac] : [0x20ac]);
});

it.each([null, "\n"])("bounds repeated empty reset allocations for %j", newline => {
  const decoder = new Utf8TextDecoder(newline);
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1024});
  let completed = 0, failure: unknown;
  try {
    for (; completed < 100; completed++) decoder.reset(meter);
  } catch (error) {failure = error;}
  expect(failure).toMatchObject({reason: "allocation"});
  expect(completed).toBeGreaterThan(0);
  expect(completed).toBeLessThan(100);
});
