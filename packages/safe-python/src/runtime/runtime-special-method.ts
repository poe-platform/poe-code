import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeDescriptorContext } from "./runtime-descriptor.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Look up an implicit special method on the receiver's actual type MRO, then
 * bind its descriptor to the receiver. Never inspect instance dictionaries,
 * ordinary attribute overrides or the type's metaclass. The object dispatcher
 * supplies the actual type; missing values remain distinct from stored None or
 * other noncallables. Binding failures propagate unchanged. Calling the result
 * and interpreting NotImplemented belong to the consuming protocol.
 */
export function lookupRuntimeSpecialMethod(
  receiver: RuntimeValue, type: TypeValue, name: Extract<RuntimeValue, { kind: "str" }>,
  descriptors: RuntimeDescriptorContext, values: RuntimeValues, meter: ExecutionMeter
): RuntimeValue | undefined {
  meter.checkpoint();
  const found = resolveRuntimeTypeAttribute(type.value, name, descriptors, values, meter);
  if (found === undefined) return undefined;
  const attribute = found.attribute;
  if (attribute.slots?.get === undefined) return attribute.value;
  const bound = attribute.slots.get(receiver, type);
  meter.checkpoint();
  return bound;
}
