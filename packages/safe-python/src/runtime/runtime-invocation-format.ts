import type { ExecutionMeter } from "./execution-budget.js";
import type { FormatContext } from "./format-protocol.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Frame-owned guest formatting; native kernels retain their fast paths.
 * Resolve live type slots on each operation, then invoke the bound result
 * through normal execution. Missing slots and non-callables remain distinct.
 */
export function createRuntimeInvocationFormatContext(values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext, fallback: FormatContext<RuntimeValue>): FormatContext<RuntimeValue> {
  meter.checkpoint(0, 128);
  return createRuntimeFormatContext(values, meter, {
    defaultRepr: fallback.defaultRepr.bind(fallback),
    typeName: invocation.typeName?.bind(invocation),
    lookupFormat(value) {
      const method = invocation.lookupSpecial?.(value, "__format__"); meter.checkpoint();
      if (method === undefined) return undefined;
      meter.checkpoint(0, 64);
      return spec => {
        meter.checkpoint(0, 8);
        return invocation.call(method, [spec]);
      };
    }
  });
}
