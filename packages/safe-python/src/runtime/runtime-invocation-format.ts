import type { ExecutionMeter } from "./execution-budget.js";
import type { FormatContext } from "./format-protocol.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Frame-owned guest formatting and representation; native kernels retain their fast paths.
 * Resolve live type slots on each operation, then invoke the bound result
 * through normal execution. Missing slots and non-callables remain distinct.
 */
export function createRuntimeInvocationFormatContext(values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext, fallback: FormatContext<RuntimeValue>): FormatContext<RuntimeValue> {
  meter.checkpoint(0, 320);
  const lookup = (value: RuntimeValue, name: string) => {
    const method = invocation.lookupSpecial?.(value, name); meter.checkpoint();
    if (method === undefined) return undefined;
    meter.checkpoint(0, 64);
    return (...args: RuntimeValue[]) => {
      meter.checkpoint(0, 16 + args.length * 8);
      return invocation.call(method, args);
    };
  };
  return createRuntimeFormatContext(values, meter, {
    defaultRepr: fallback.defaultRepr.bind(fallback),
    typeName: invocation.typeName?.bind(invocation),
    lookupFormat: value => lookup(value, "__format__"),
    lookupStr: value => lookup(value, "__str__"),
    lookupRepr: value => lookup(value, "__repr__")
  });
}
