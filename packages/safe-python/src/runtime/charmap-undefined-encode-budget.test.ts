import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCharmap} from "./runtime-charmap.js";
import {RuntimeValues, type BuiltinInvocationContext} from "./runtime-values.js";

const cases = (["strict", "callback"] as const).flatMap(policy => ["A", "AB"].map(text => ({policy, text})));

it.each(cases)("admits undefined charmap faults before $policy recovery for $text", ({policy, text}) => {
  const maximum = 1000000;
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: maximum});
  const values = new RuntimeValues(meter), codec = new RuntimeCharmap(values, meter);
  const mapping = values.cell({}), input = CodePointString.fromString(text, meter);
  let mappings = 0, recoveries = 0;
  const context: BuiltinInvocationContext = {
    lookupSpecial: () => mapping,
    call() {
      mappings++;
      if (mappings === text.length) meter.checkpoint(0, maximum - meter.usage.allocatedBytes);
      return values.none;
    }
  };
  const recovery = () => {
    recoveries++;
    throw new Error("recovery must not run after allocation exhaustion");
  };
  const run = () => codec.encode(input, mapping, policy === "strict" ? policy : recovery, context);
  let failure: unknown;
  try {run();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(mappings).toBe(text.length);
  expect(recoveries).toBe(0);
  let repeated: unknown;
  try {run();} catch (error) {repeated = error;}
  expect(repeated).toBe(failure);
  expect(mappings).toBe(text.length);
});
