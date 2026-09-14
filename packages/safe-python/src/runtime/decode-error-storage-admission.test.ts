import {expect, it} from "vitest";
import {PythonDecodeError} from "./decode-error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";

it.each([0, 1, 256])("admits the owned decode-error buffer header for %i input bytes", length => {
  const input = new Uint8Array(length);
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: length});
  let failure: unknown;
  try {new PythonDecodeError("utf-8", input, 0, length, "invalid input", meter);}
  catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(() => meter.checkpoint()).toThrow(failure as ExecutionLimitError);
  expect(input).toEqual(new Uint8Array(length));
});

it("retains an independent fault snapshot and exact locations after admission", () => {
  const input = Uint8Array.of(255, 65);
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 10000});
  const fault = new PythonDecodeError("utf-8", input, 0, 1, "invalid start byte", meter);
  input.fill(0);
  expect(fault.object).toEqual(Uint8Array.of(255, 65));
  expect(fault.message).toBe("'utf-8' codec can't decode byte 0xff in position 0: invalid start byte");
  expect(fault).toMatchObject({encoding: "utf-8", start: 0, end: 1, reason: "invalid start byte"});
  expect(meter.usage.allocatedBytes).toBeGreaterThan(input.byteLength);
});

it("retains terminal cancellation identity before copying a fault input", () => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 10000, signal: controller.signal});
  controller.abort();
  let failure: unknown;
  try {new PythonDecodeError("utf-8", Uint8Array.of(255), 0, 1, "invalid start byte", meter);}
  catch (error) {failure = error;}
  expect(failure).toMatchObject({reason: "cancelled"});
  try {meter.checkpoint();}
  catch (error) {expect(error).toBe(failure);}
  expect(meter.usage.allocatedBytes).toBe(0);
});
