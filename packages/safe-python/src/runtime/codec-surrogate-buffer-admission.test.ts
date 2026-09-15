import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {RuntimeExceptionState} from "./runtime-exception-state.js";
import {RuntimeRaisedException} from "./runtime-exception-execution.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues, type BuiltinInvocationContext, type RuntimeValue} from "./runtime-values.js";
import {OrderedKeyMap} from "./ordered-key-map.js";

it.each([1, 2, 4])("admits surrogateescape temporary storage before inspecting %i rejected characters", length => {
  let budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const meter = {checkpoint(steps = 1, bytes = 0) {budget.checkpoint(steps, bytes);}};
  const values = new RuntimeValues(meter);
  const keys = {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => a === b};
  const types = new RuntimeTypeRegistry(values, keys, meter);
  const state = new RuntimeExceptionState(values.tuple([]), meter);
  const error = values.instance(types.exceptionType("UnicodeEncodeError"), undefined, state);
  state.assignMember("object", values.string("A".repeat(length)), meter);
  state.assignMember("start", values.integer(0), meter);
  state.assignMember("end", values.integer(length), meter);
  const registry = new RuntimeCodecRegistry(values, meter);
  const handler = registry.lookupError("surrogateescape");
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  let allowance = 64 + length - 1, chained = 0;
  const context: BuiltinInvocationContext = {
    call() {throw Error("unexpected callback");},
    isException() {
      budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: allowance});
      return true;
    },
    chainException(value) {chained++; return new RuntimeRaisedException(value, meter);}
  };
  if (handler.kind !== "builtin_function_or_method") throw Error("expected native handler");
  const invoke = () => handler.value.invoke([error], keywords, meter, context);
  let failure: unknown;
  try {invoke();} catch (caught) {failure = caught;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  expect(chained).toBe(0);
  let retry: unknown;
  try {invoke();} catch (caught) {retry = caught;}
  expect(retry).toBe(failure);

  // With sufficient space, declining recovery still raises the original guest
  // exception through normal chaining; admission must not alter that contract.
  allowance = 512;
  budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  try {invoke(); expect.fail("expected rejected surrogate recovery");}
  catch (caught) {
    expect(caught).toBeInstanceOf(RuntimeRaisedException);
    expect((caught as RuntimeRaisedException).value).toBe(error);
  }
  expect(chained).toBe(1);
});
