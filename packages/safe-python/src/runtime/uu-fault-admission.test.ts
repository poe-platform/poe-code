import {expect, it} from "vitest";
import {BinasciiError} from "./binascii-error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeUu, encodeUu} from "./uuencode.js";

const cases = [
  {encode: true, input: new Uint8Array(46), message: "At most 45 bytes at once"},
  {encode: false, input: new Uint8Array(), message: "Missing length byte"},
  {encode: false, input: Uint8Array.of(33, 255), message: "Illegal char"},
  {encode: false, input: Uint8Array.of(32, 65), message: "Trailing garbage"}
];

it.each(cases)("admits UU fault storage: $message", ({encode, input, message}) => {
  const original = input.slice();
  const exhausted = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 128});
  expect(() => encode ? encodeUu(input, false, exhausted) : decodeUu(input, exhausted)).toThrow(ExecutionLimitError);
  expect(() => exhausted.checkpoint()).toThrow(ExecutionLimitError);
  expect(input).toEqual(original);
  const sufficient = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 4096});
  expect(() => encode ? encodeUu(input, false, sufficient) : decodeUu(input, sufficient)).toThrow(new BinasciiError(message));
});
