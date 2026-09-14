import {expect, it} from "vitest";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {OrderedKeyMap} from "./ordered-key-map.js";
import {RuntimeCodecRegistry} from "./runtime-codec-registry.js";
import {createRuntimeCodecRegistryFunctions} from "./runtime-codec-registry-functions.js";
import {RuntimeValues, type BuiltinInvocationContext, type RuntimeValue} from "./runtime-values.js";

const names = ["lookup", "register", "unregister", "register_error", "lookup_error", "_unregister_error", "encode", "decode"];

it.each(names)("%s admits invalid-arity diagnostics before exposing a catchable error", name => {
  for (const count of [0, 4]) {
    const meter = new ExecutionBudget({maxSteps: 100000, maxAllocatedBytes: 1000000});
    const values = new RuntimeValues(meter);
    let calls = 0;
    const registry = new RuntimeCodecRegistry(values, meter, () => {calls++;});
    const functions = createRuntimeCodecRegistryFunctions(registry);
    const keywords = values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>({hash: () => 0n, equal: (a, b) => a === b}, meter));
    const args = Array.from({length: count}, () => values.none);
    const context: BuiltinInvocationContext = {call() {calls++; return values.none;}};
    const invoke = () => functions.get(name)!.value.invoke(args, keywords, meter, context);
    // Allow entry binding storage and the empty keyword snapshot, but no
    // diagnostic. Rejection must latch termination rather than allocate a
    // guest error.
    meter.checkpoint(0, 1000000 - meter.usage.allocatedBytes - 160);
    let failure: unknown;
    try {invoke();} catch (error) {failure = error;}
    expect(failure, `${count} arguments`).toBeInstanceOf(ExecutionLimitError);
    expect(failure).toMatchObject({reason: "allocation"});
    let retry: unknown;
    try {invoke();} catch (error) {retry = error;}
    expect(retry).toBe(failure);
    expect(calls).toBe(0);
  }
});
