import {expect, it} from "vitest";
import {decodeByteEscape} from "./byte-escape.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget, ExecutionLimitError, type ExecutionMeter} from "./execution-budget.js";

const cases = [
  {input: [92], policy: "ignore", message: "Trailing \\ in string"},
  {input: [65, 92, 120, 48, 90], policy: "strict", message: "invalid \\x escape at position 1"},
  {input: [92, 120], policy: "unknown", message: "decoding error; unknown error handling code: unknown"},
];

it.each(cases)("admits byte escape fault storage before rejection: $message", ({input, policy, message}) => {
  const source = Uint8Array.from(input), scratch = 64 + source.length;
  const exhausted = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: scratch + 255});
  const warn = () => {throw Error("warning must not precede decoding failure");};
  let failure: unknown;
  try {decodeByteEscape(source, policy, exhausted, warn);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(exhausted.usage.allocatedBytes).toBe(scratch);
  expect(() => exhausted.checkpoint()).toThrow(failure as ExecutionLimitError);
  expect([...source]).toEqual(input);
  const sufficient = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 10000});
  expect(() => decodeByteEscape(source, policy, sufficient, warn)).toThrow(new PythonRuntimeError("ValueError", message));
});

it.each(cases)("preserves terminal cancellation at byte escape fault admission: $message", ({input, policy}) => {
  const failure = new ExecutionLimitError("cancelled");
  const meter: ExecutionMeter = {checkpoint(_steps, bytes = 0) {if (bytes === 256) throw failure;}};
  let actual: unknown;
  try {decodeByteEscape(Uint8Array.from(input), policy, meter, () => {throw Error("unexpected warning");});}
  catch (error) {actual = error;}
  expect(actual).toBe(failure);
});
