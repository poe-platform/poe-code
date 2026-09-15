import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeUnicodeEscape, UnicodeEscapeDecoder} from "./unicode-escape.js";

const cases = [
  {bytes: [92, 113], marker: 113, escape: "q", points: [92, 113], kind: "escape"},
  {bytes: [92, 255], marker: 255, escape: "ÿ", points: [92, 255], kind: "escape"},
  {bytes: [92, 55, 55, 55], marker: 511, escape: "777", points: [511], kind: "octal escape"},
];

it.each(cases)("admits warning storage before delivering marker $marker", ({bytes}) => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 64 + bytes.length * 4});
  let warnings = 0, failure: unknown;
  try {decodeUnicodeEscape(Uint8Array.from(bytes), false, "strict", meter, true, () => {warnings++;});}
  catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(warnings).toBe(0);
  let retry: unknown;
  try {meter.checkpoint();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each(cases)("observes cancellation before delivering marker $marker and retains buffered input", ({bytes}) => {
  const controller = new AbortController();
  const budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000, signal: controller.signal});
  let allocations = 0, warnings = 0;
  const decoder = new UnicodeEscapeDecoder(false, "strict", () => {warnings++;});
  decoder.setstate([Uint8Array.of(92), 0n]);
  // Joined input and scratch output precede warning rendering. Cancellation at
  // the next allocation must win before the warning service gains control.
  const meter = {checkpoint(steps = 1, allocatedBytes = 0) {
    if (allocatedBytes > 0 && ++allocations === 3) controller.abort();
    budget.checkpoint(steps, allocatedBytes);
  }};
  expect(() => decoder.decode(Uint8Array.from(bytes.slice(1)), true, meter)).toThrow(ExecutionLimitError);
  expect(warnings).toBe(0);
  expect(decoder.getstate()).toEqual([Uint8Array.of(92), 0n]);
});

it.each(cases)("preserves warning payload and decoded output for marker $marker", ({bytes, marker, escape, points, kind}) => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000});
  const warnings: unknown[] = [];
  const result = decodeUnicodeEscape(Uint8Array.from(bytes), false, "strict", meter, true,
    (...args) => {warnings.push(args);});
  expect(warnings).toEqual([[`"\\${escape}" is an invalid ${kind} sequence. Such sequences will not work in the future. `, marker, 0]]);
  expect([...result.text]).toEqual(points);
  expect(result.consumed).toBe(bytes.length);
});

it("preserves a warning service failure and its pending incremental state", () => {
  const failure = Error("warning filter failed");
  const decoder = new UnicodeEscapeDecoder(false, "strict", () => {throw failure;});
  decoder.setstate([Uint8Array.of(92), 0n]);
  expect(() => decoder.decode(Uint8Array.of(113), true,
    new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000}))).toThrow(failure);
  expect(decoder.getstate()).toEqual([Uint8Array.of(92), 0n]);
});
