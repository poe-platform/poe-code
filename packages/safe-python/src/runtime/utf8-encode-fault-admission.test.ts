import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {encodeUtf8, type Utf8EncodeRecovery} from "./utf8-encode.js";

const cases = (["strict", "surrogateescape", "callback"] as const).flatMap(policy =>
  [[0xd800], [0x41, 0xd800, 0xdfff]].map(points => ({policy, points})));

it.each(cases)("admits UTF-8 surrogate fault storage before $policy recovery: $points", ({policy, points}) => {
  const input = new CodePointString(Uint32Array.from(points));
  // Permit the working output buffer, but no exception allocation. Input is
  // immutable and belongs to the caller, outside this operation's budget.
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 64 + input.length * 4});
  let calls = 0;
  const recover: Utf8EncodeRecovery = () => {
    calls++;
    throw new Error("recovery ran without admitting its fault");
  };
  const run = () => encodeUtf8(input, policy === "callback" ? recover : policy, meter);
  let failure: unknown;
  try {run();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(calls).toBe(0);
  let repeated: unknown;
  try {run();} catch (error) {repeated = error;}
  expect(repeated).toBe(failure);
  expect(calls).toBe(0);
});
