import {expect, it} from "vitest";
import {BinasciiError, decodeBase64} from "./base64.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";

const failures = [
  {input: "=", strict: true, message: "Leading padding not allowed"},
  {input: "AAAA=", strict: true, message: "Excess padding not allowed"},
  {input: "!", strict: true, message: "Only base64 data is allowed"},
  {input: "AA=A", strict: true, message: "Discontinuous padding not allowed"},
  {input: "AA==A", strict: true, message: "Excess data after padding"},
  {input: "A", strict: false, message: "Invalid base64-encoded string: number of data characters (1) cannot be 1 more than a multiple of 4"},
  {input: "AA", strict: false, message: "Incorrect padding"},
];

it.each(failures)("admits Base64 fault storage before reporting $message", ({input, strict, message}) => {
  const bytes = Uint8Array.from(input, character => character.charCodeAt(0));
  // The scratch buffer fits, but the exception and its diagnostic do not.
  const exhausted = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 128});
  expect(() => decodeBase64(bytes, strict, exhausted)).toThrow(ExecutionLimitError);
  expect(() => exhausted.checkpoint()).toThrow(ExecutionLimitError);
  expect([...bytes]).toEqual([...input].map(character => character.charCodeAt(0)));

  const sufficient = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 4096});
  expect(() => decodeBase64(bytes, strict, sufficient)).toThrow(new BinasciiError(message));
});
