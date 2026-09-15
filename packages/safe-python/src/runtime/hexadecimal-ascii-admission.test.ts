import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {createRuntimeHexadecimalFunctions} from "./runtime-hexadecimal-functions.js";
import {RuntimeValues, type RuntimeValue} from "./runtime-values.js";

it.each(["unhexlify", "a2b_hex"])("%s admits empty ASCII scratch storage before result construction", name => {
  const setup = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
  const values = new RuntimeValues(setup);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, setup));
  const functions = new Map(createRuntimeHexadecimalFunctions(values, setup));
  const source = values.string("");
  // Invocation state and one array owner fit, but scratch plus result do not.
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 160});
  expect(() => functions.get(name)!.value.invoke([source], keywords, meter)).toThrow(ExecutionLimitError);
  expect(meter.usage.allocatedBytes).toBe(160);
  expect(() => meter.checkpoint()).toThrow(ExecutionLimitError);
});
