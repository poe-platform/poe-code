import { lookupMroAttribute } from "./class-attributes.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { BuiltinInvocationContext, MethodDescriptorValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** An immediate attribute call can invoke a native method descriptor directly.
 * Custom attribute lookup, instance shadows and aliases retain bound calls. */
export function runtimeDirectMethod(receiver: RuntimeValue, name: string, callee: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, invocation: BuiltinInvocationContext): MethodDescriptorValue | undefined {
  if (callee.kind !== "builtin_function_or_method" || callee.binding?.instance !== receiver || callee.binding.descriptor.kind !== "method_descriptor") return undefined;
  const type = invocation.actualType?.(receiver); meter.checkpoint();
  if (type === undefined) return undefined;
  const key = values.string(name), mro = type.value.mro;
  if (receiver.kind === "instance") {
    if (receiver.dictionary?.items.containsKey(key)) return undefined;
    const attributeName = values.string("__getattribute__");
    const getter = lookupMroAttribute(mro, attributeName, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
    if (getter !== mro[mro.length - 1].namespace.items.lookup(attributeName)?.value) return undefined;
  }
  const raw = lookupMroAttribute(mro, key, (owner, key) => owner.namespace.items.lookup(key), meter)?.value;
  return raw === callee.binding.descriptor ? callee.binding.descriptor : undefined;
}
