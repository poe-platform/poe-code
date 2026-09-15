import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCharmap} from "./runtime-charmap.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

it.each(["empty input", "empty mapping result", "expanded mapping result"])("admits charmap decoded result storage: %s", mode => {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(setup);
  const mapping = values.builtinFunction({name: "mapping", invoke: () => values.none});
  const replacement = values.string(mode === "expanded mapping result" ? "A🐍" : "");
  const input = mode === "empty input" ? new Uint8Array() : new Uint8Array([65]);
  // Enough for the adapter and accumulated points, but not the returned
  // record, string wrapper and two typed-array headers, even with no points.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 160});
  let calls = 0;
  const context: BuiltinInvocationContext = {
    isStopIteration: () => false,
    lookupSpecial: () => mapping,
    call: () => { calls++; return replacement; }
  };
  const codec = new RuntimeCharmap(values, meter);
  let failure: unknown;
  try { codec.decode(input, mapping, "strict", context); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(calls).toBe(input.length);
  expect(() => codec.decode(input, mapping, "strict", context)).toThrow(failure as Error);
  expect(() => codec.encode(replacement.value, mapping, "strict", context)).toThrow(failure as Error);
  expect(calls).toBe(input.length);
});
