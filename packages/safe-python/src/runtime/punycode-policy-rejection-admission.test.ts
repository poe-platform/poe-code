import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {decodePunycode} from "./punycode.js";

const policies = ["surrogatepass", "backslashreplace", "unknown", "x".repeat(4096)];

it.each(policies)("admits unsupported Punycode policy fault storage (case %#)", policy => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 64});
  let failure: unknown;
  try {decodePunycode(new Uint8Array(), policy, meter);} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {decodePunycode(new Uint8Array(), "strict", meter);} catch (error) {retry = error;}
  expect(retry).toBe(failure);
});

it.each(policies)("preserves eager Punycode policy rejection (case %#)", policy => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
  let called = false;
  expect(() => decodePunycode(Uint8Array.of(65, 45), policy, meter, () => {
    called = true;
    throw new Error("must reject before prefix decoding");
  })).toThrow(new PythonRuntimeError("UnicodeError", `Unsupported error handling: ${policy}`));
  expect(called).toBe(false);
});
