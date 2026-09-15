import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeDescriptorContext } from "./runtime-descriptor.js";
import { resolveRuntimeClassAttribute } from "./runtime-descriptor.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import { getRuntimeMethodDescriptor } from "./runtime-method-descriptor.js";
import type { RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

export interface RuntimeSpecialMethodContext extends RuntimeDescriptorContext {
  /** Classify the actual guest type without ordinary instance attribute access. */
  typeOf(value: RuntimeValue): TypeValue;
}

/** Instance/type records own their actual type. The external policy classifies
 * remaining native or opaque values; guest __class__ never participates. */
export function runtimeActualType(value: RuntimeValue, context: RuntimeSpecialMethodContext, meter: ExecutionMeter): TypeValue {
  meter.checkpoint();
  if (value.kind === "instance") return value.type;
  if (value.kind === "type") return value.metaclass;
  if ((value.kind === "staticmethod" || value.kind === "classmethod") && value.type !== undefined) return value.type;
  const type = context.typeOf(value); meter.checkpoint(); return type;
}

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
  const slot = type.value.nativeSlots.methods.get(name);
  if (slot?.kind === "absent") return undefined;
  // Native wrapper slots have an intrinsic descriptor. Bind directly instead
  // of allocating a class-attribute record and a one-use descriptor closure.
  if (slot?.kind === "native" && slot.value.kind === "wrapper_descriptor") {
    return getRuntimeMethodDescriptor(slot.value, receiver, type, values, meter, descriptors.typeOf?.bind(descriptors));
  }
  const attribute = slot?.kind === "native" ? resolveRuntimeClassAttribute(slot.value, descriptors, values, meter)
    : resolveRuntimeTypeAttribute(type.value, name, descriptors, values, meter)?.attribute;
  if (attribute === undefined) return undefined;
  if (attribute.slots?.get === undefined) return attribute.value;
  const bound = attribute.slots.get(receiver, type);
  meter.checkpoint();
  return bound;
}
