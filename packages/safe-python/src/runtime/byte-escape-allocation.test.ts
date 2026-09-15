import {expect, it} from "vitest";
import {decodeByteEscape} from "./byte-escape.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";

it("rejects empty byte escape decoding when no buffer allocation is available", () => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 0});
  const input = new Uint8Array();
  const run = () => decodeByteEscape(input, "strict", meter, () => {throw Error("unexpected warning");});
  let failure: unknown;
  try {run();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(run).toThrow(failure as ExecutionLimitError);
});

it("admits the returned byte buffer after a warning service consumes allocation", () => {
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000});
  let warnings = 0;
  const run = () => decodeByteEscape(Uint8Array.of(92, 113), "strict", meter, () => {
    warnings++;
    // Leave enough for the two output bytes, but no storage for their buffer.
    meter.checkpoint(0, 1000 - meter.usage.allocatedBytes - 2);
  });
  let failure: unknown;
  try {run();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {run();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(warnings).toBe(1);
});

it.each([false, true])("preserves warning-service cancellation (throws=%s)", throws => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 1000, signal: controller.signal});
  let warnings = 0;
  const run = () => decodeByteEscape(Uint8Array.of(92, 113), "strict", meter, () => {
    warnings++;
    controller.abort();
    if (throws) throw Error("warning service failed after cancellation");
  });
  let failure: unknown;
  try {run();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "cancelled"});
  let retry: unknown;
  try {run();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(warnings).toBe(1);
});
