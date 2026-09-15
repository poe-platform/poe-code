import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {runtimeComparison} from "./runtime-comparison.js";
import {RuntimeExceptionState} from "./runtime-exception-state.js";
import {RuntimeTypeRegistry} from "./runtime-type-registry.js";
import {RuntimeValues, type BuiltinInvocationContext, type RuntimeValue} from "./runtime-values.js";

const names = ["strict", "ignore", "replace", "xmlcharrefreplace", "backslashreplace", "namereplace", "surrogatepass", "surrogateescape"];

function fixture() {
  let budget = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 2000000});
  const meter = {checkpoint(steps = 1, bytes = 0) {budget.checkpoint(steps, bytes);}};
  const values = new RuntimeValues(meter);
  const keys = {hash: () => 0n, equal: (a: RuntimeValue, b: RuntimeValue) => runtimeComparison("==", a, b, values, meter).value};
  const registry = new RuntimeCodecRegistry(values, meter);
  const types = new RuntimeTypeRegistry(values, keys, meter);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, meter));
  const exhaust = () => {budget = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 0});};
  return {meter, values, registry, types, keywords, exhaust};
}

function expectTerminal(operation: () => unknown) {
  let failure: unknown;
  try {operation();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {operation();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
}

it.each(names.flatMap(name => ["arity", "keywords"].map(kind => ({name, kind}))))("admits $name $kind rejection before creating an exception", ({name, kind}) => {
  const {meter, values, registry, keywords, exhaust} = fixture();
  const handler = registry.lookupError(name);
  if (handler.kind !== "builtin_function_or_method") throw Error("expected native handler");
  if (kind === "keywords") keywords.items.set(values.string("object"), values.none);
  const args = kind === "arity" ? [] : [values.none];
  exhaust();
  expectTerminal(() => handler.value.invoke(args, keywords, meter));
});

it("admits strict's non-exception rejection", () => {
  const {meter, values, registry, keywords, exhaust} = fixture();
  const handler = registry.lookupError("strict");
  if (handler.kind !== "builtin_function_or_method") throw Error("expected native handler");
  const context: BuiltinInvocationContext = {call: () => values.none, isStopIteration: () => false};
  exhaust();
  expectTerminal(() => handler.value.invoke([values.none], keywords, meter, context));
});

it.each([
  ["ignore", "UnicodeEncodeError", "object", "missing"],
  ["replace", "UnicodeDecodeError", "object", "wrong"],
  ["surrogatepass", "UnicodeEncodeError", "encoding", "missing"],
  ["surrogatepass", "UnicodeDecodeError", "encoding", "wrong"]
] as const)("admits %s rejection of %s %s (%s) after classification", (name, type, field, problem) => {
  const {meter, values, registry, types, keywords, exhaust} = fixture();
  const state = new RuntimeExceptionState(values.tuple([]), meter);
  if (problem === "wrong") state.assignMember(field, values.none, meter);
  const error = values.instance(types.exceptionType(type), undefined, state);
  const handler = registry.lookupError(name);
  if (handler.kind !== "builtin_function_or_method") throw Error("expected native handler");
  let classifications = 0;
  const context: BuiltinInvocationContext = {
    call: () => values.none, isStopIteration: () => false,
    isException(_error, candidate) {
      classifications++;
      if (candidate !== type) return false;
      exhaust();
      return true;
    }
  };
  expectTerminal(() => handler.value.invoke([error], keywords, meter, context));
  expect(classifications).toBe(type === "UnicodeEncodeError" ? 1 : 2);
});
