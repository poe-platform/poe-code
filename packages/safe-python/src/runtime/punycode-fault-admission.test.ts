import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {PythonRuntimeError} from "./error.js";
import {decodePunycode} from "./punycode.js";

it.each([
  {source: "999999999999999999a", budget: 2040},
  {source: "a-999999999999999999a", budget: 2048},
])("admits Punycode position overflow storage for $source", ({source, budget}) => {
  const input = Uint8Array.from(source, character => character.charCodeAt(0));
  // These budgets fit all digit arithmetic and prefix storage, leaving no
  // space for the overflow exception. The failure must remain uncatchable.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: budget});
  expect(() => decodePunycode(input, "strict", meter)).toThrow(ExecutionLimitError);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
  expect([...input]).toEqual([...source].map(character => character.charCodeAt(0)));
  expect(() => decodePunycode(input, "strict",
    new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 10000})))
    .toThrow(new PythonRuntimeError("OverflowError", "Python int too large to convert to C ssize_t"));
});

it("admits the retained IndexError and suffix view for incomplete Punycode", () => {
  // The old 719-byte charge included arithmetic and both UnicodeDecodeErrors,
  // but omitted the uppercase suffix header and retained IndexError.
  const meter = new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 719});
  expect(() => decodePunycode(Uint8Array.of(122), "strict", meter)).toThrow(ExecutionLimitError);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
  let failure: unknown;
  try {
    decodePunycode(Uint8Array.of(122), "strict",
      new ExecutionBudget({maxSteps: 1000, maxAllocatedBytes: 10000}));
  } catch (error) {failure = error;}
  expect(failure).toMatchObject({
    name: "UnicodeDecodeError", start: 1, end: 2,
    reason: "incomplete punycode string",
    chaining: {suppressContext: true, context: {
      name: "UnicodeDecodeError", object: Uint8Array.of(90),
      chaining: {context: {name: "IndexError", message: "index out of range"}},
    }},
  });
});
