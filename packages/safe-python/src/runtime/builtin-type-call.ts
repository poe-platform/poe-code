import type { ExecutionMeter } from "./execution-budget.js";
import type { RuntimeValues, TypeValue, WrapperDescriptorValue } from "./runtime-values.js";

/** The explicit type.__call__ slot enters default calling, not metaclass
 * __call__ lookup. The execution supplies argument-preserving construction and
 * inspection policy, including a bounded call-stack entry. */
export function createTypeCallWrapper(values: RuntimeValues, meter: ExecutionMeter, typeType: TypeValue): WrapperDescriptorValue {
  meter.checkpoint(1, 96);
  return values.wrapperDescriptor({ owner: typeType, name: "__call__", accepts(instance, meter) {
    if (instance.kind !== "type") return false;
    for (const ancestor of instance.metaclass.value.mro) { meter.checkpoint(); if (ancestor === typeType.value) return true; }
    return false;
  }, invoke(instance, positional, keywords, meter, invocation) {
    meter.checkpoint();
    if (invocation?.callTypeDefault === undefined) throw Error("type calls require a default type-call policy");
    const result = invocation.callTypeDefault(instance as TypeValue, positional, keywords);
    meter.checkpoint(); return result;
  } });
}
