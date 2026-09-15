import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCodecRegistryFunctions} from "./runtime-codec-registry-functions.js";
import {RuntimeValues, type BuiltinInvocationContext, type RuntimeValue} from "./runtime-values.js";

function fixture() {
  const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
  const values = new RuntimeValues(meter);
  let calls = 0;
  const registry = new RuntimeCodecRegistry(values, meter, () => {calls++;});
  const functions = createRuntimeCodecRegistryFunctions(registry);
  const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
  const context: BuiltinInvocationContext = {call() {calls++; return values.none;}};
  return {meter, values, keywords, context, calls: () => calls,
    invoke: (name: string, args: readonly RuntimeValue[]) => functions.get(name)!.value.invoke(args, keywords, meter, context)};
}

function exhaustAfterBinding(f: ReturnType<typeof fixture>, remaining: number, invoke: () => unknown) {
  f.meter.checkpoint(0, 1000000 - f.meter.usage.allocatedBytes - remaining);
  let failure: unknown;
  try {invoke();} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(failure).toMatchObject({reason: "allocation"});
  let retry: unknown;
  try {invoke();} catch (error) {retry = error;}
  expect(retry).toBe(failure);
  expect(f.calls()).toBe(0);
}

it.each(["lookup", "register", "unregister", "register_error", "lookup_error", "_unregister_error"])("%s admits forbidden-keyword error storage", name => {
  const f = fixture();
  f.keywords.items.set(f.values.string("name"), f.values.none);
  exhaustAfterBinding(f, 160, () => f.invoke(name, [f.values.none]));
});

it.each(["encode", "decode"])("%s admits duplicate-argument error storage", name => {
  const f = fixture();
  f.keywords.items.set(f.values.string("obj"), f.values.none);
  exhaustAfterBinding(f, 220, () => f.invoke(name, [f.values.none]));
});

it.each(["encode", "decode"])("%s admits non-string keyword error storage", name => {
  const f = fixture();
  f.keywords.items.set(f.values.none, f.values.none);
  exhaustAfterBinding(f, 220, () => f.invoke(name, [f.values.none]));
});

it.each(["lookup", "lookup_error", "_unregister_error", "register_error", "encode", "decode"])("%s admits invalid name diagnostics after the type-name service", name => {
  const f = fixture();
  const invalid = f.values.integer(42n);
  let names = 0;
  f.context.typeName = () => {
    names++;
    f.meter.checkpoint(0, 1000000 - f.meter.usage.allocatedBytes);
    return "int";
  };
  const args = name === "encode" || name === "decode" ? [f.values.none, invalid]
    : name === "register_error" ? [invalid, f.values.none] : [invalid];
  exhaustAfterBinding(f, 1000, () => f.invoke(name, args));
  expect(names).toBe(1);
});
