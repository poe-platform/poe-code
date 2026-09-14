import type { ExecutionMeter } from "./execution-budget.js";
import type { FormatContext } from "./format-protocol.js";
import { createRuntimeFormatContext } from "./runtime-format.js";
import type { RuntimeRepresentationState } from "./runtime-representation.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** Frame-owned guest formatting and representation; native kernels retain their fast paths.
 * Resolve live type slots on each operation, then invoke the bound result
 * through normal execution. Missing slots and non-callables remain distinct.
 */
export function createRuntimeInvocationFormatContext(values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext, fallback: FormatContext<RuntimeValue>, state?: RuntimeRepresentationState): FormatContext<RuntimeValue> {
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
    defaultRepr(value) {
      if (invocation.actualType === undefined) return fallback.defaultRepr(value);
      const type = invocation.actualType(value); meter.checkpoint();
      const identity = (invocation.identity ?? values.identity).id(value); meter.checkpoint();
      const hex = identity.toString(16); meter.checkpoint(0, 32 + 2 * hex.length);
      // PyObject_Repr's NULL-slot fallback uses tp_name, unlike the explicit
      // object.__repr__ wrapper, which reads __module__ and __qualname__.
      return values.string(`<${type.value.diagnosticName} object at 0x${hex}>`);
    },
    typeName: invocation.typeName?.bind(invocation),
    lookupFormat: value => lookup(value, "__format__"),
    lookupStr: value => lookup(value, "__str__"),
    lookupRepr: value => lookup(value, "__repr__")
  }, state);
}
