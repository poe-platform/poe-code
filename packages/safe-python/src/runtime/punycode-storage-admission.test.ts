import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodePunycode, encodePunycode} from "./punycode.js";

it.each(["encode", "decode"] as const)("admits empty Punycode %s output storage", operation => {
  // The scratch array costs 64 bytes. Encoding returns a typed array;
  // decoding constructs a string wrapper and two typed arrays (copying input).
  const required = operation === "encode" ? 128 : 256;
  const run = (meter: ExecutionBudget) => operation === "encode"
    ? encodePunycode(new CodePointString(new Uint32Array()), meter)
    : decodePunycode(new Uint8Array(), "strict", meter);
  const insufficient = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: required - 1});
  expect(() => run(insufficient)).toThrow(ExecutionLimitError);
  expect(() => insufficient.checkpoint()).toThrow(ExecutionLimitError);
  const exact = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: required});
  expect([...run(exact)]).toEqual([]);
  expect(exact.usage.allocatedBytes).toBe(required);
});

it("admits the ASCII prefix view before entering the decoder service", () => {
  const input = Uint8Array.of(65, 45);
  const meter = new ExecutionBudget({maxSteps: 100, maxAllocatedBytes: 127});
  let calls = 0;
  expect(() => decodePunycode(input, "strict", meter, () => {
    calls++;
    return new CodePointString(Uint32Array.of(65));
  })).toThrow(ExecutionLimitError);
  expect(calls).toBe(0);
  expect([...input]).toEqual([65, 45]);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
});
