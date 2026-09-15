import type { ExecutionMeter } from "./execution-budget.js";
import type { LengthProtocolContext } from "./length-protocol.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";
import { createRuntimeIndexContext } from "./runtime-index-context.js";

/** Adapt execution-owned special lookup/calls to shared length validation.
 * Explicit index policies retain their receivers. Otherwise __index__ follows
 * the same MRO lookup/call path as __len__, without coercion through __int__.
 */
export function createRuntimeLengthContext(invocation: BuiltinInvocationContext, meter: ExecutionMeter): LengthProtocolContext<RuntimeValue> {
  meter.checkpoint(0, 384);
  const lookup = (value: RuntimeValue, name: string) => {
    const method = invocation.lookupSpecial?.(value, name); meter.checkpoint();
    if (method === undefined) return undefined;
    meter.checkpoint(0, 64);
    return () => { meter.checkpoint(0, 8); return invocation.call(method, []); };
  };
  const index = invocation.integerIndex ?? createRuntimeIndexContext(invocation, meter);
  return {
    lookupLength: value => lookup(value, "__len__"),
    integer: index.integer.bind(index), isExactInteger: index.isExactInteger.bind(index),
    lookupIndex: index.lookupIndex.bind(index), typeName: index.typeName.bind(index), warn: index.warn.bind(index)
  };
}
